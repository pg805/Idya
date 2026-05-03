module.exports = {
    apps: [
        {
            name: 'idya-dev',
            script: './lib/server/index.js',
            cwd: '/home/mac-admin/Idya',
            env: {
                NODE_ENV: 'development',
                PORT: 3001
            },
            watch: false
        }
    ]
}
