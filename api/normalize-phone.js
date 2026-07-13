// Vercel Serverless Function: Normalize Kenyan Phone Number

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { phone } = req.body;

        if (!phone) {
            return res.status(400).json({ error: 'Phone number is required' });
        }

        let normalized = phone.toString().trim().replace(/\s+/g, '');

        // Remove + prefix if present
        if (normalized.startsWith('+')) {
            normalized = normalized.substring(1);
        }

        // Convert 2547xx to 07xx format
        if (normalized.startsWith('254')) {
            normalized = '0' + normalized.substring(3);
        }

        // If it doesn't start with 0, but is 9 digits (e.g. 722...), add 0
        if (!normalized.startsWith('0') && normalized.length === 9) {
            normalized = '0' + normalized;
        }

        // Validate length (should be 10 digits for Kenyan numbers starting with 0)
        if (normalized.length !== 10 || !/^0[17]\d{8}$/.test(normalized)) {
            return res.status(400).json({
                error: 'Invalid phone number format. Must be like 07... or 01...'
            });
        }

        return res.status(200).json({
            normalized_phone: normalized,
            formatted: `+${normalized}`
        });

    } catch (error) {
        console.error('Phone normalization error:', error);
        return res.status(500).json({
            error: 'Failed to normalize phone number'
        });
    }
}
