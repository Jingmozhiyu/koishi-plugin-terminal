import {dirname, join} from "node:path";
import {chmodSync, statSync} from "node:fs";
import * as os from "node:os";

export function resolveShell(shell?: string) {
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

export function resolveShellArgs(shell?: string) {
    if (process.platform !== "darwin") return [];
    return /(^|\/)(zsh|bash|sh)$/.test(resolveShell(shell)) ? ["-l"] : [];
}

export function resolveRoot(root?: string) {
    return root || os.homedir();
}

export function resolveEnv(shell?: string) {
    const env: NodeJS.ProcessEnv = {...process.env, HOME: os.homedir()};
    if (process.platform === "darwin" && /(^|\/)zsh$/.test(resolveShell(shell))) {
        env.ZDOTDIR = os.homedir();
    }
    return env;
}

export function getKey(session: any) {
    return `${session.platform}:${session.userId}`;
}

export function fixNodePtyHelper() {
    if (process.platform !== 'darwin') return;

    try {
        const root = dirname(require.resolve('node-pty/package.json'));
        const helper = join(root, 'prebuilds', `darwin-${process.arch}`, 'spawn-helper');
        const mode = statSync(helper).mode;
        if (!(mode & 0o111)) chmodSync(helper, mode | 0o755);
    } catch {}
}

export function isInteractiveCommand(command: string) {
    const trimmed = command.trim();
    if (!trimmed) return false;

    const [name, ...args] = trimmed.split(/\s+/);

    if (/^(vi|vim|nvim|nano|emacs)$/.test(name)) return true
    if (/^(less|more)$/.test(name)) return true
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
