module.exports = {
    apps: [
        {
            name: 'idya-dev',
            script: './lib/server/index.js',
            cwd: '/home/mac-admin/Idya',
            env: {
                NODE_ENV: 'development',
                PORT: 3001,
                HOST_URL: 'http://10.0.0.52:3001'
            },
            watch: false
        },
        {
            name: 'webhook',
            script: './webhook/index.js',
            cwd: '/home/mac-admin/Idya',
            watch: false
        }
    ]
}
