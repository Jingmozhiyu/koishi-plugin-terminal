export function stripBackspaces(input: string) {
    const chars: string[] = [];
    for (const char of input) {
        if (char === '\b') {
            chars.pop();
        } else {
            chars.push(char);
        }
    }
    return chars.join('');
}

export function stripAnsi(input: string) {
    const text = stripBackspaces(input.replace(
        // eslint-disable-next-line no-control-regex
        /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g,
        ''
    ))

    return text
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.split('\r').at(-1))
        .join('\n')
}
