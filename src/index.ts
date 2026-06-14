import {Context, h} from 'koishi'
import * as pty from "node-pty";
import {clearTimeout} from "node:timers";
import {stripAnsi} from "./stripper";
import {Config} from "./config";
import {fixNodePtyHelper, getKey, isInteractiveCommand, resolveShell} from "./helper";

export * from './config'

export const name = 'terminal'

export interface ShellSession {
    terminal: pty.IPty;
    buffer: string;
    timer?: NodeJS.Timeout;
    timeoutTimer?: NodeJS.Timeout;
    disposables: Array<{ dispose(): void }>
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
            env: {
                ...process.env,
                PAGER: 'cat',
                MANPAGER: 'cat',
                GIT_PAGER: 'cat',
                LESS: '-FRX',
            }
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

            await session.send(h.text(text));
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

    ctx.command("shell [command:text]", "Start a persistent shell session.", {authority: config.auth})
        .option("terminate", "-t Terminate current shell session")
        .usage("After start up, user messages will be sent to shell process.")
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
