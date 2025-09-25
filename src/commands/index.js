module.exports = function(env) {
    const { fs } = env;

    function print(line = '') {
        env.stdout.write(line + '\n');
    }

    async function cmd_help() {
        print('Available commands:');
        print('  help                Show this help');
        print('  pwd                 Print working directory');
        print('  ls [path]           List directory');
        print('  info <name>         Show info for root item');
        print('  cd <path>           Change directory');
        print('  clear               Clear the screen');
        print('  exit                Exit the shell');
    }

    async function cmd_pwd() {
        if (typeof fs.getPath === 'function') {
            print(fs.getPath());
        } else {
            print(env.cwd);
        }
    }

    async function cmd_ls(args) {
        const path = fs.join(env.cwd, args[0] || '.');
        const items = typeof fs.listDisplay === 'function' ? await fs.listDisplay(path) : await fs.list(path);
        if (!items.length) return;
        print('');
        print(items.join('\n'));
    }

    async function cmd_cd(args) {
        if (!args[0]) throw new Error('Usage: cd <path>');
        const result = await fs.changeDir(env.cwd, args[0]);
        if (typeof result === 'string') {
            env.cwd = result;
            print('Changed folder to ' + args[0]);
        } else if (result && typeof result === 'object' && 'path' in result) {
            env.cwd = result.path;
            if (result.message) print(result.message);
        } else {
            env.cwd = '/';
        }
    }

    async function cmd_info(args) {
        if (!args[0]) throw new Error('Usage: info <name>');
        if (typeof fs.info !== 'function') throw new Error('info not supported by filesystem');
        const data = await fs.info(env.cwd, args[0]);
        const text = JSON.stringify(data, null, 2);
        print(text);
    }

    async function cmd_clear() {
        // ANSI clear screen
        print('\x1Bc');
    }

    async function cmd_exit() {
        process.exit(0);
    }

    return {
        help: cmd_help,
        pwd: cmd_pwd,
        ls: cmd_ls,
        info: cmd_info,
        cd: cmd_cd,
        clear: cmd_clear,
        exit: cmd_exit,
    };
};



