const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const allowedOrigins = new Set(
    (process.env.ALLOWED_ORIGINS || 'https://lin13423.github.io')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
);
const requestBuckets = new Map();

app.use(express.json({ limit: '32kb' }));
app.use(cors({
    origin(origin, callback) {
        // Non-browser clients do not send Origin. Keep those requests usable,
        // while browsers are limited to explicitly trusted origins.
        if (!origin || allowedOrigins.has(origin)) return callback(null, true);
        return callback(null, false);
    }
}));

function rateLimit(req, res, next) {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const bucket = requestBuckets.get(key) || { startedAt: now, count: 0 };

    if (now - bucket.startedAt >= 60_000) {
        bucket.startedAt = now;
        bucket.count = 0;
    }

    bucket.count += 1;
    requestBuckets.set(key, bucket);

    if (bucket.count > 20) {
        return res.status(429).json({ error: 'Too many payment requests. Try again later.' });
    }

    return next();
}

app.post('/stk-push', rateLimit, async (req, res) => {
    try {
        const { environment, shortcode, passkey, consumerKey, consumerSecret, accountType, amount, phoneNumber } = req.body;
        const required = { environment, shortcode, passkey, consumerKey, consumerSecret, accountType, amount, phoneNumber };
        const missing = Object.entries(required)
            .filter(([, value]) => value === undefined || value === null || value === '')
            .map(([key]) => key);
        if (missing.length > 0) {
            return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
        }

        if (!['production', 'sandbox'].includes(environment)) {
            return res.status(400).json({ error: 'Invalid payment environment.' });
        }

        if (!['Paybill', 'Buy Goods'].includes(accountType)) {
            return res.status(400).json({ error: 'Invalid account type.' });
        }

        const numericAmount = Number(amount);
        if (!Number.isInteger(numericAmount) || numericAmount < 1 || numericAmount > 150000) {
            return res.status(400).json({ error: 'Amount must be a whole number between 1 and 150000.' });
        }

        if (!/^\d{5,10}$/.test(String(shortcode)) || !/^\d{9,12}$/.test(String(phoneNumber))) {
            return res.status(400).json({ error: 'Invalid shortcode or phone number.' });
        }

        if (String(passkey).length > 256 || String(consumerKey).length > 256 || String(consumerSecret).length > 512) {
            return res.status(400).json({ error: 'Payment credential format is invalid.' });
        }
        
        const baseUrl = environment === 'production' 
            ? 'https://api.safaricom.co.ke' 
            : 'https://sandbox.safaricom.co.ke';

        // 1. Get OAuth Token
        const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
        const tokenResponse = await axios.get(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
            headers: { 'Authorization': `Basic ${auth}` }
        });
        const accessToken = tokenResponse.data.access_token;
        if (!accessToken) {
            const tokenError = new Error('Safaricom OAuth response did not include an access_token');
            tokenError.upstreamStatus = tokenResponse.status || 502;
            tokenError.upstreamPayload = tokenResponse.data;
            throw tokenError;
        }

        // 2. Generate Password & Timestamp
        const date = new Date();
        const timestamp = date.getFullYear() +
            String(date.getMonth() + 1).padStart(2, '0') +
            String(date.getDate()).padStart(2, '0') +
            String(date.getHours()).padStart(2, '0') +
            String(date.getMinutes()).padStart(2, '0') +
            String(date.getSeconds()).padStart(2, '0');

        const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
        const transactionType = accountType === 'Paybill' ? 'CustomerPayBillOnline' : 'CustomerBuyGoodsOnline';

        // 3. Send STK Push Request
        const stkResponse = await axios.post(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
            BusinessShortCode: shortcode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: transactionType,
            Amount: numericAmount,
            PartyA: phoneNumber,
            PartyB: shortcode,
            PhoneNumber: phoneNumber,
            CallBackURL: 'https://mydomain.com/callback',
            AccountReference: 'AssetGuardPro',
            TransactionDesc: 'Subscription Payment'
        }, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        res.json(stkResponse.data);
    } catch (error) {
        const upstreamPayload = error.response?.data || error.upstreamPayload;
        const status = error.response?.status || error.upstreamStatus || 500;
        console.error('STK push failed:', upstreamPayload || error.message);
        res.status(status).json({
            error: 'Payment request failed.',
            upstreamStatus: status
        });
    }
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

    process.on('unhandledRejection', (reason) => {
        console.error('Unhandled promise rejection:', reason);
    });
    process.on('uncaughtException', (error) => {
        console.error('Uncaught exception:', error);
    });
}

module.exports = app;
