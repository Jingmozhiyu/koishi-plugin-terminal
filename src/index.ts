import {Context, Schema, Time} from 'koishi'
import * as pty from "node-pty";
import {chmodSync, statSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {clearTimeout} from "node:timers";

export const name = 'terminal'


export interface Config {
    admin?: Array<string>;
    auth?:number;
    root?: string;
    shell?: string;
    timeout?: number;
    cols?: number;
    rows?: number;
    maxOutputLength: number;
}

export interface ShellSession {
    terminal: pty.IPty;
    buffer: string;
    timer?: NodeJS.Timeout;
    timeoutTimer?: NodeJS.Timeout;
    disposables: Array<{ dispose(): void }>
}

export const Config: Schema<Config> = Schema.object({
    admin: Schema.array(String).description("超级管理员用户名单").default([]),
    auth: Schema.number().description("使用本插件所需的最低权限，此外，用户也需要在超级管理员名单中。").min(1).max(4).step(1).default(4),
    root: Schema.string().description("初始工作路径").default(process.env.HOME),
    shell: Schema.string().description("Shell路径，留空则自动检测系统默认Shell"),
    timeout: Schema.number().description("超时时长").default(Time.minute),
    cols: Schema.number().description("终端列数").default(80),
    rows: Schema.number().description("终端行数").default(24),
    maxOutputLength: Schema.number().description('单次发送最大输出长度').default(16384),
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
    const text = input.replace(
        // eslint-disable-next-line no-control-regex
        /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g,
        ''
    )

    return text
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.split('\r').at(-1))
        .join('\n')
}

function getKey(session: any) {
    return `${session.platform}:${session.userId}`;
}

function fixNodePtyHelper() {
    if (process.platform !== 'darwin') return;

    try {
        const root = dirname(require.resolve('node-pty/package.json'));
        const helper = join(root, 'prebuilds', `darwin-${process.arch}`, 'spawn-helper');
        const mode = statSync(helper).mode;
        if (!(mode & 0o111)) chmodSync(helper, mode | 0o755);
    } catch {}
}

function isInteractiveCommand(command: string) {
    const trimmed = command.trim();
    if (!trimmed) return false;

    const [name, ...args] = trimmed.split(/\s+/);

    if (/^(vi|vim|nvim|nano|emacs)$/.test(name)) return true
    if (/^(less|more|man)$/.test(name)) return true
    if (/^(top|htop|btop|watch)$/.test(name)) return true
    if (/^(tmux|screen)$/.test(name)) return true
    if (/^(sftp|ftp|telnet)$/.test(name)) return true
    if (/^(mysql|psql|sqlite3|redis-cli|mongosh)$/.test(name)) return true
    if (/^(node|python|python3|ipython|ruby|irb|php|lua|R)$/.test(name) && !args.length) return true

    if (name === 'tail' && args.includes('-f')) return true
    if (name === 'docker' && args.includes('exec') && args.some(arg => arg.includes('it'))) return true
    if (name === 'kubectl' && args.includes('exec') && args.some(arg => arg.includes('it'))) return true
    return false;
}

const map = new Map<string, ShellSession>();

export function apply(ctx: Context, config: Config) {
    fixNodePtyHelper();

    const allowedUsers = config.admin;

    function refreshTimeout(shellSession: ShellSession, key: string, session: any) {
        if (!config.timeout) return;
        if (shellSession.timeoutTimer) clearTimeout(shellSession.timeoutTimer);

        shellSession.timeoutTimer = setTimeout(async () => {
            if (map.get(key) !== shellSession) return;
            cleanupSession(shellSession, key, true);
            await session.send("Shell session timed out.");
        }, config.timeout);
    }

    function sendCommand(shellSession: ShellSession, key: string, session: any, command: string) {
        refreshTimeout(shellSession, key, session);

        if (isInteractiveCommand(command)) {
            shellSession.terminal.write(`echo "Interactive command is not supported in chat terminal. Use a non-interactive form, or run shell -t to restart."\r`);
            return;
        }

        shellSession.terminal.write(command + "\r");
    }

    function initSession(session, key:string): ShellSession {
        const terminal = pty.spawn(resolveShell(config.shell), [], {
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

            await session.send(text);
        }

        const dataDisposable = terminal.onData((data) => {
            shellSession.buffer += data;
            if (shellSession.timer) clearTimeout(shellSession.timer);
            shellSession.timer = setTimeout(flush, 300);
        })

        const exitDisposable = terminal.onExit(async () => {
            flush();
            cleanupSession(shellSession,key,false);
            await session.send("Shell exited.")
        })

        shellSession.disposables.push(dataDisposable, exitDisposable);
        map.set(key, shellSession);
        refreshTimeout(shellSession, key, session);
        return shellSession;
    }

    function cleanupSession(shellSession: ShellSession,key:string,kill=true) {
        map.delete(key);
        if (shellSession.timer) clearTimeout(shellSession.timer);
        if (shellSession.timeoutTimer) clearTimeout(shellSession.timeoutTimer);
        shellSession.disposables.forEach((d) => d.dispose());
        shellSession.disposables.length = 0

        if (kill) {
            try {
                shellSession.terminal.kill()
            } catch {}
        }
    }

    ctx.command("shell [command:text]", "Start a persistent shell session", {authority: config.auth})
        .option("terminate", "-t Terminate current shell session")
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

                cleanupSession(current,key,true);
                return "Shell session terminated."
            }

            //shell
            let current = map.get(key)
            if (!current) {
                current = initSession(session, key);
                if (!command) return "Shell session started. Send regular messages as commands. Send shell -t to terminate."
            }

            if (!command) return "Shell session is running."
            sendCommand(current, key, session, command)
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

        sendCommand(current, key, session, content);
    }, true)

    ctx.on("dispose", () => {
        for (const current of map.values()) {
            current.disposables.forEach((d) => d.dispose())
            if (current.timer) clearTimeout(current.timer)
            if (current.timeoutTimer) clearTimeout(current.timeoutTimer)
            current.terminal.kill()
        }

        map.clear()
    })
}
