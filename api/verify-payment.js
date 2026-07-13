// Vercel Serverless Function: Verify M-Pesa STK Push Payment via Daraja API
// Uses /mpesa/stkpushquery/v1/query to check the status of an STK Push request
//
// Environment Variables Required:
//   DARAJA_CONSUMER_KEY    - Safaricom Daraja consumer key
//   DARAJA_CONSUMER_SECRET - Safaricom Daraja consumer secret
//   DARAJA_SHORTCODE_PAYBILL  - Business Paybill shortcode (used for password generation)
//   DARAJA_PASSKEY_PAYBILL    - Lipa Na M-Pesa Online passkey (paybill)
//   DARAJA_ENV                - "sandbox" or "production" (default: sandbox)

const DARAJA_BASE_URLS = {
    sandbox: 'https://sandbox.safaricom.co.ke',
    production: 'https://api.safaricom.co.ke',
};

/**
 * Get a Daraja OAuth2 access token
 * Daraja OAuth: POST /oauth/v1/generate?grant_type=client_credentials
 * Auth: Basic (base64 encoded consumer_key:consumer_secret)
 */
async function getAccessToken(consumerKey, consumerSecret, baseUrl) {
    const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

    const response = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${credentials}`,
        },
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OAuth failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return data.access_token;
}

/**
 * Generate the Daraja STK Push password
 * Password = Base64(BusinessShortCode + Passkey + Timestamp)
 */
function generatePassword(shortcode, passkey, timestamp) {
    const raw = `${shortcode}${passkey}${timestamp}`;
    return Buffer.from(raw).toString('base64');
}

/**
 * Get current timestamp in Daraja format: YYYYMMDDHHmmss
 */
function getTimestamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return (
        `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
        `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    );
}

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { reference } = req.query;

        if (!reference) {
            return res.status(400).json({ error: 'Reference (CheckoutRequestID) is required' });
        }

        const consumerKey = process.env.DARAJA_CONSUMER_KEY;
        const consumerSecret = process.env.DARAJA_CONSUMER_SECRET;
        const businessShortCode = process.env.DARAJA_SHORTCODE_PAYBILL;
        const passkey = process.env.DARAJA_PASSKEY_PAYBILL;
        const envKey = process.env.DARAJA_ENV || 'sandbox';

        if (!consumerKey || !consumerSecret) {
            return res.status(500).json({ error: 'Payment service credentials not configured' });
        }

        const baseUrl = DARAJA_BASE_URLS[envKey] || DARAJA_BASE_URLS.sandbox;

        // Get OAuth2 access token
        const accessToken = await getAccessToken(consumerKey, consumerSecret, baseUrl);

        // Build STK Push Query request
        const timestamp = getTimestamp();
        const password = generatePassword(businessShortCode, passkey, timestamp);

        const queryPayload = {
            BusinessShortCode: businessShortCode,
            Password: password,
            Timestamp: timestamp,
            CheckoutRequestID: reference,
        };

        const response = await fetch(`${baseUrl}/mpesa/stkpushquery/v1/query`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(queryPayload),
        });

        const result = await response.json();

        console.log('Daraja STK Query response:', JSON.stringify(result));

        // Daraja ResultCode "0" = success, "1032" = user cancelled, "1037" = timeout
        const resultCode = String(result.ResultCode || '');
        let status;
        let success = false;

        if (resultCode === '0') {
            status = 'COMPLETED';
            success = true;
        } else if (resultCode === '1032' || resultCode === '1033') {
            status = 'CANCELLED';
        } else if (resultCode === '1037' || resultCode === '1') {
            status = 'TIMEOUT';
        } else if (resultCode === '2001' || resultCode === '1036') {
            status = 'FAILED';
        } else if (resultCode === '') {
            status = 'PENDING';
        } else {
            status = 'PENDING';
        }

        return res.status(200).json({
            success,
            status,
            result_code: resultCode,
            reason: result.ResultDesc || result.ResponseDescription || '',
            amount: result.Amount || null,
            mpesa_receipt: result.MpesaReceiptNumber || null,
            transaction_date: result.TransactionDate || null,
            reference,
        });
    } catch (error) {
        console.error('Payment verification error:', error);
        return res.status(200).json({
            success: false,
            status: 'PENDING',
            message: 'Verification in progress',
        });
    }
}
