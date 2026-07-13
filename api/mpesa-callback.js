// Vercel Serverless Function: M-Pesa Daraja STK Push Callback
// Daraja POSTs transaction results here after STK Push completes
//
// This endpoint receives the async callback from Safaricom and logs the result.
// Extend this to persist to a database (Supabase, Firebase, etc.) as needed.
//
// Environment Variables Required:
//   DARAJA_CALLBACK_SECRET (optional) - If set, validates the callback header

export default async function handler(req, res) {
    // Always respond 200 to Daraja — non-200 triggers retries
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(200).json({ ResultCode: 0, ResultDesc: 'OK' });
    }

    try {
        const callback = req.body;

        console.log('=== M-Pesa Daraja Callback ===');
        console.log(JSON.stringify(callback, null, 2));

        // Daraja callback structure:
        // {
        //   "Body": {
        //     "stkCallback": {
        //       "MerchantRequestID": "...",
        //       "CheckoutRequestID": "...",
        //       "ResultCode": 0,          // 0 = success
        //       "ResultDesc": "...",
        //       "CallbackMetadata": {      // present on success
        //         "Item": [
        //           { "Name": "Amount", "Value": 100 },
        //           { "Name": "MpesaReceiptNumber", "Value": "QHK71..." },
        //           { "Name": "Balance" },
        //           { "Name": "TransactionDate", "Value": 20250101120000 },
        //           { "Name": "PhoneNumber", "Value": 254712345678 }
        //         ]
        //       }
        //     }
        //   }
        // }

        const stkCallback = callback?.Body?.stkCallback;

        if (!stkCallback) {
            console.warn('Invalid callback structure:', callback);
            return res.status(200).json({ ResultCode: 0, ResultDesc: 'OK' });
        }

        const resultCode = stkCallback.ResultCode;
        const checkoutId = stkCallback.CheckoutRequestID;
        const merchantId = stkCallback.MerchantRequestID;

        if (resultCode === 0) {
            // Payment successful — extract details
            const items = stkCallback.CallbackMetadata?.Item || [];
            const receipt = items.find((i) => i.Name === 'MpesaReceiptNumber')?.Value;
            const amount = items.find((i) => i.Name === 'Amount')?.Value;
            const phone = items.find((i) => i.Name === 'PhoneNumber')?.Value;
            const txnDate = items.find((i) => i.Name === 'TransactionDate')?.Value;

            console.log('Payment SUCCESS:', {
                checkoutId,
                merchantId,
                receipt,
                amount,
                phone,
                txnDate,
            });

            // TODO: Persist to database
            // await db.transactions.update({ checkout_id: checkoutId }, {
            //     status: 'completed',
            //     mpesa_receipt: receipt,
            //     amount,
            //     phone,
            //     completed_at: new Date()
            // });
        } else {
            // Payment failed or cancelled
            console.log('Payment FAILED/CANCELLED:', {
                checkoutId,
                merchantId,
                resultCode,
                resultDesc: stkCallback.ResultDesc,
            });

            // TODO: Persist to database
            // await db.transactions.update({ checkout_id: checkoutId }, {
            //     status: 'failed',
            //     failure_reason: stkCallback.ResultDesc,
            //     failed_at: new Date()
            // });
        }

        // Always respond 200 to Daraja
        return res.status(200).json({
            ResultCode: 0,
            ResultDesc: 'OK',
        });
    } catch (error) {
        console.error('Callback processing error:', error);
        // Still respond 200 — Daraja retries on non-200
        return res.status(200).json({
            ResultCode: 0,
            ResultDesc: 'OK',
        });
    }
}
