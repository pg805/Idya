import 'dotenv/config';
import { createServer } from 'http';
import { createHmac } from 'crypto';
import { exec } from 'child_process';

const SECRET = process.env.WEBHOOK_SECRET ?? '';
const PORT = process.env.WEBHOOK_PORT ?? 9000;

createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/webhook') {
        res.writeHead(404);
        return res.end();
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
        const sig = req.headers['x-hub-signature-256'];
        const expected = 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
        if (sig !== expected) {
            res.writeHead(401);
            return res.end('Unauthorized');
        }

        const event = req.headers['x-github-event'];
        const payload = JSON.parse(body);

        if (event === 'push' && payload.ref === 'refs/heads/dev') {
            res.writeHead(200);
            res.end('Deploying');
            exec('/home/mac-admin/Idya/deploy.sh', (err, stdout, stderr) => {
                if (err) console.error('Deploy error:', stderr);
                else console.log('Deploy output:', stdout);
            });
        } else {
            res.writeHead(200);
            res.end('Ignored');
        }
    });
}).listen(PORT, () => console.log(`Webhook listener on port ${PORT}`));
