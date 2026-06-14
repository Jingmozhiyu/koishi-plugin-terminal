import {Context, Schema, Time} from 'koishi'
import * as pty from "node-pty";
import {clearTimeout} from "node:timers";

export const name = 'terminal'


export interface Config {
    admin?: Array<string>;
    root?: string;
    shell?: string;
    encoding?: string;
    timeout?: number;
    cols?: number;
    rows?: number;
    maxOutputLength: number;
}

export interface ShellSession {
    terminal: pty.IPty;
    buffer: string;
    timer?: NodeJS.Timeout;
    disposables: Array<{ dispose(): void }>
}

export const Config: Schema<Config> = Schema.object({
    admin: Schema.array(String).description("超级管理员用户，具有绝对权限。"),
    root: Schema.string().description("初始工作路径。").default(process.env.HOME),
    shell: Schema.string().description("Shell路径。留空则自动检测系统默认Shell。"),
    encoding: Schema.string().description("输出内容编码。").default("utf8"),
    timeout: Schema.number().description("超时时长。").default(Time.minute),
    cols: Schema.number().description("终端列数").default(80),
    rows: Schema.number().description("终端行数").default(24),
    maxOutputLength: Schema.number().description('单次发送最大输出长度。').default(1800),
})

function resolveShell(shell?: string) {
    if (shell) return shell;
    switch (process.platform) {
        case "win32":
            return process.env.COMSPEC || "powershell.exe";
        case "darwin":
            return process.env.SHELL || "zsh";
        case "linux":
            return process.env.SHELL || "bash";
    }
    return "bash";
}

function stripAnsi(input: string) {
    return input.replace(
        // eslint-disable-next-line no-control-regex
        /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g,
        ''
    )
}

function getKey(session: any) {
    return `${session.platform}:${session.userId}`;
}


const map = new Map<string, ShellSession>();

export function apply(ctx: Context, config: Config) {

    const allowedUsers = config.admin;

    function sendCommand(shellSession: ShellSession, command: string) {
        shellSession.terminal.write(command + "\r");
        shellSession.terminal.write("pwd\r");
    }

    function initSession(session, key): ShellSession {
        const terminal = pty.spawn(config.shell, [], {
            name: "terminal",
            cols: config.cols,
            rows: config.rows,
            cwd: config.root,
            env: process.env,
        })

        const shellSession: ShellSession = {
            terminal,
            buffer: "",
            disposables: [],
        }

        const flush = async () => {
            shellSession.timer = undefined;
            const output = stripAnsi(shellSession.buffer).trim();
            shellSession.buffer = "";

            if (!output) return;

            const text = output.length > config.maxOutputLength ?
                output.slice(0, config.maxOutputLength - 1) + "\n ...Truncated output"
                : output

            await session.send(text + "$");
        }

        const dataDisposable = terminal.onData((data) => {
            shellSession.buffer += data;
            if (shellSession.timer) clearTimeout(shellSession.timer);
            shellSession.timer = setTimeout(flush, 300);
        })

        const exitDisposable = terminal.onExit(async () => {
            cleanupSession(shellSession);
            await session.send("Shell exited.")
        })

        shellSession.disposables.push(dataDisposable, exitDisposable);
        map.set(key, shellSession);
        return shellSession;
    }

    function cleanupSession(shellSession: ShellSession) {
        shellSession.disposables.forEach((d) => d.dispose());
        shellSession.terminal.kill();
        if (shellSession.timer) clearTimeout(shellSession.timer);
    }

    ctx.command("shell [command:text]", "Start a persistent shell session", {authority: 4})
        .option("terminate", "-t --terminate Terminate current shell session")
        .usage("After start up, regular user messages will be sent to shell process.")
        .example("shell echo Operating System: Three Easy Pieces > qljj.txt")
        .action(async ({session, options}, command) => {


            if (!allowedUsers.includes(session.userId)) {
                return "Unauthorized user."
            }

            const key = getKey(session);

            // shell -t
            if (options.terminate) {
                const current = map.get(key);
                if (!current) return "There doesn't exist running shell session."

                cleanupSession(current);
                return "Shell session terminated."
            }

            //shell
            let current = map.get(key)
            if (!current) {
                current = initSession(session, key);
                if (!command) return "Shell session started. Send regular messages as commands. Send shell -t to terminate."
            }

            if (!command) return "Shell session is running."
            sendCommand(current, command)
        })

    ctx.middleware(async (session, next) => {
        const key = getKey(session);
        const current = map.get(key);

        if (!current) return next();

        const content = session.content.trim();

        if (content === "shell" || content === "shell -t") {
            return next();
        }

        if (!content) return;

        sendCommand(current, content);
    }, true)

    ctx.on("dispose", () => {
        for (const current of map.values()) {
            current.disposables.forEach((d) => d.dispose())
            if (current.timer) clearTimeout(current.timer)
            current.terminal.kill()
        }

        map.clear()
    })
}
