const readline = require('readline');

function createShell(filesystemAdapter, options = {}) {
    const env = {
        fs: filesystemAdapter,
        cwd: '/',
        prompt: options.prompt || 'drive> ',
        commands: {},
        stdout: options.stdout || process.stdout,
        stderr: options.stderr || process.stderr,
    };

    const commands = require('./commands')(env);
    env.commands = commands;

    function print(line) {
        env.stdout.write(line + '\n');
    }

    function exec(line) {
        const trimmed = (line || '').trim();
        if (!trimmed) return;
        const [cmd, ...args] = trimmed.split(/\s+/);
        const handler = env.commands[cmd];
        if (!handler) {
            print(`Unknown command: ${cmd}. Type 'help'`);
            return;
        }
        Promise.resolve(handler(args))
            .catch(err => {
                print(String(err && err.message ? err.message : err));
            });
    }

    function start() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: env.prompt,
            historySize: 200,
            completer: (line) => {
                const cmds = Object.keys(env.commands);
                const hits = cmds.filter(c => c.startsWith(line));
                return [hits.length ? hits : cmds, line];
            }
        });

        rl.on('line', (line) => {
            exec(line);
            rl.prompt();
        });

        rl.on('close', () => {
            process.exit(0);
        });

        rl.prompt();
    }

    return { start, exec, env };
}

module.exports = { createShell };



