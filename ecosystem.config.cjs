module.exports = {
    apps: [
        {
            name: 'idya-dev',
            script: './lib/server/index.js',
            cwd: '/home/mac-admin/Idya',
            env: {
                NODE_ENV: 'development',
                PORT: 3000,
                HOST_URL: 'http://10.0.0.52:3000',
                DATABASE_URL: process.env.DATABASE_URL
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
