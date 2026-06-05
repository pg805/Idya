import 'dotenv/config';
import { createServer } from 'http';
import { createHmac } from 'crypto';
import { exec } from 'child_process';

const SECRET = process.env.WEBHOOK_SECRET ?? '';
const PORT = process.env.WEBHOOK_PORT ?? 9000;

// All log lines go through here so they're consistently prefixed for
// correlation with cloudflared journal / pm2 logs. PM2 also prefixes
// each line with a timestamp when started with --time, but we include
// our own ISO timestamp so log lines stay grep-friendly even if PM2
// timestamps get stripped.
function log(line) {
    console.log(`[webhook] ${new Date().toISOString()} ${line}`);
}

createServer((req, res) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '-';
    const ua = (req.headers['user-agent'] || '-').slice(0, 80);
    const delivery = req.headers['x-github-delivery'] || '-';
    log(`req ${req.method} ${req.url} ip=${ip} ua=${ua} delivery=${delivery}`);

    if (req.method !== 'POST' || req.url !== '/webhook') {
        log(`-> 404 (method/url mismatch)`);
        res.writeHead(404);
        return res.end();
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
        const sig = req.headers['x-hub-signature-256'];
        const expected = 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
        if (sig !== expected) {
            log(`-> 401 (bad signature)`);
            res.writeHead(401);
            return res.end('Unauthorized');
        }

        const event = req.headers['x-github-event'];
        let payload;
        try { payload = JSON.parse(body); }
        catch (e) {
            log(`-> 400 (bad JSON) error=${e.message}`);
            res.writeHead(400);
            return res.end('Bad payload');
        }

        if (event === 'push' && payload.ref === 'refs/heads/dev') {
            log(`-> 200 (deploy dev) sha=${(payload.after || '').slice(0,7)}`);
            res.writeHead(200);
            res.end('Deploying dev');
            exec('bash /home/mac-admin/Idya/deploy.sh', (err, stdout, stderr) => {
                if (stdout) console.log('Deploy stdout:', stdout);
                if (stderr) console.log('Deploy stderr:', stderr);
                if (err) log(`deploy dev failed exit=${err.code}`);
                else     log(`deploy dev ok`);
            });
        } else if (event === 'push' && payload.ref === 'refs/heads/main') {
            log(`-> 200 (deploy prod) sha=${(payload.after || '').slice(0,7)}`);
            res.writeHead(200);
            res.end('Deploying prod');
            exec('bash /home/mac-admin/Idya-prod/deploy-prod.sh', (err, stdout, stderr) => {
                if (stdout) console.log('Deploy stdout:', stdout);
                if (stderr) console.log('Deploy stderr:', stderr);
                if (err) log(`deploy prod failed exit=${err.code}`);
                else     log(`deploy prod ok`);
            });
        } else {
            log(`-> 200 (ignored) event=${event} ref=${payload.ref || '-'}`);
            res.writeHead(200);
            res.end('Ignored');
        }
    });
}).listen(PORT, () => log(`listener on port ${PORT}`));
