const express = require('express');
const fs = require('fs');
const path = require('path');
const twilio = require('twilio');
const {
    readJobLog,
    toMaskedPhone,
    geographyLabelFromPhone,
    unique,
    normalizeRecipient,
    getOutboundWhatsappFrom
} = require('./jobStorage');

const router = express.Router();

const {
    TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
} = process.env;

const imageStreamClients = new Set();

function getGalleryImages() {
    if (!fs.existsSync('output')) {
        return [];
    }

    return fs.readdirSync('output')
        .filter((file) => file.toLowerCase().endsWith('_twilio.png'))
        .map((file) => ({
            name: file,
            url: `/${file}`,
            created: fs.statSync(path.join('output', file)).birthtime
        }))
        .sort((a, b) => new Date(b.created) - new Date(a.created));
}

function getGallerySignature(items) {
    return items
        .map((item) => `${item.name}:${new Date(item.created).getTime()}`)
        .join('|');
}

function pushImageEvent(event, payload) {
    const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;

    for (const client of imageStreamClients) {
        try {
            client.write(data);
        } catch (error) {
            // Client disconnected; it will be cleaned up on close.
        }
    }
}

let lastGallerySignature = getGallerySignature(getGalleryImages());

const imageWatcherInterval = setInterval(() => {
    const images = getGalleryImages();
    const signature = getGallerySignature(images);

    if (signature !== lastGallerySignature) {
        lastGallerySignature = signature;
        pushImageEvent('images_update', {
            count: images.length,
            timestamp: Date.now()
        });
    }
}, 1500);

if (typeof imageWatcherInterval.unref === 'function') {
    imageWatcherInterval.unref();
}

function buildAnimeStats() {
    const jobs = readJobLog().filter((job) => job.messageType === 'image');
    const successfulJobs = jobs.filter((job) => job.status === 'success');
    const failedJobs = jobs.filter((job) => job.status === 'failed');
    const users = unique(jobs.map((job) => job.from));

    const userMap = new Map();
    for (const job of jobs) {
        if (!job.from) continue;

        const current = userMap.get(job.from) || {
            phoneNumber: job.from,
            maskedPhoneNumber: toMaskedPhone(job.from),
            totalAttempts: 0,
            successfulImages: 0,
            failedImages: 0,
            lastSeen: job.updatedAt || job.createdAt
        };

        current.totalAttempts += 1;
        if (job.status === 'success') current.successfulImages += 1;
        if (job.status === 'failed') current.failedImages += 1;

        const currentLastSeen = new Date(current.lastSeen || 0);
        const jobDate = new Date(job.updatedAt || job.createdAt || 0);
        if (jobDate > currentLastSeen) {
            current.lastSeen = job.updatedAt || job.createdAt;
        }

        userMap.set(job.from, current);
    }

    const userStats = [...userMap.values()].sort((a, b) => {
        return new Date(b.lastSeen || 0) - new Date(a.lastSeen || 0);
    });

    const topUsers = [...userStats]
        .sort((a, b) => {
            if (b.successfulImages !== a.successfulImages) {
                return b.successfulImages - a.successfulImages;
            }
            if (b.totalAttempts !== a.totalAttempts) {
                return b.totalAttempts - a.totalAttempts;
            }
            return new Date(b.lastSeen || 0) - new Date(a.lastSeen || 0);
        })
        .slice(0, 5)
        .map((user) => ({
            phoneNumber: user.phoneNumber,
            maskedPhoneNumber: user.maskedPhoneNumber,
            successfulImages: user.successfulImages,
            totalAttempts: user.totalAttempts
        }));

    const geographyMap = new Map();
    for (const user of userStats) {
        const key = geographyLabelFromPhone(user.phoneNumber);
        const current = geographyMap.get(key) || {
            label: key,
            userCount: 0,
            successfulImages: 0
        };

        current.userCount += 1;
        current.successfulImages += user.successfulImages;
        geographyMap.set(key, current);
    }

    const geography = [...geographyMap.values()].sort((a, b) => {
        if (b.successfulImages !== a.successfulImages) {
            return b.successfulImages - a.successfulImages;
        }
        return b.userCount - a.userCount;
    });

    return {
        totals: {
            totalImages: successfulJobs.length,
            successfulImages: successfulJobs.length,
            failedImages: failedJobs.length,
            uniqueUsers: users.length,
            totalImageRequests: jobs.length
        },
        users: userStats,
        topUsers,
        geography
    };
}

// API endpoint to get list of all images
router.get('/api/images', async (req, res) => {
    try {
        const files = getGalleryImages();
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.json(files);
    } catch (error) {
        console.error('Error reading images:', error);
        res.status(500).json({ error: 'Failed to load images' });
    }
});

router.get('/api/images/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
    }

    imageStreamClients.add(res);

    res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);

    const heartbeat = setInterval(() => {
        res.write(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
    }, 20000);

    req.on('close', () => {
        clearInterval(heartbeat);
        imageStreamClients.delete(res);
        res.end();
    });
});

// API endpoint to get stats
router.get('/api/stats', async (req, res) => {
    try {
        const stats = buildAnimeStats();
        res.json(stats);
    } catch (error) {
        console.error('Error building anime stats:', error);
        res.status(500).json({ error: 'Failed to load anime stats' });
    }
});

// API endpoint to send outreach messages
router.post('/api/outreach/send', async (req, res) => {
    try {
        const recipients = Array.isArray(req.body.recipients) ? req.body.recipients : [];
        const message = String(req.body.message || '').trim();

        if (!recipients.length) {
            return res.status(400).json({ error: 'Please provide at least one recipient.' });
        }

        if (!message) {
            return res.status(400).json({ error: 'Message is required.' });
        }

        const from = getOutboundWhatsappFrom();
        if (!from) {
            return res.status(400).json({ error: 'No outbound WhatsApp sender found. Set TWILIO_WHATSAPP_FROM in .env.' });
        }

        const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
        const uniqueRecipients = unique(recipients.map(normalizeRecipient));

        const results = await Promise.allSettled(
            uniqueRecipients.map((to) => twilioClient.messages.create({ from, to, body: message }))
        );

        const successful = results.filter((result) => result.status === 'fulfilled').length;
        const failed = results.length - successful;

        res.json({
            sent: successful,
            failed,
            totalRecipients: uniqueRecipients.length
        });
    } catch (error) {
        console.error('Error sending outreach messages:', error);
        res.status(500).json({ error: 'Failed to send outreach messages' });
    }
});

// API endpoint to pick a winner
router.post('/api/outreach/pick-winner', async (req, res) => {
    try {
        const fallbackRecipients = buildAnimeStats().users.map((user) => user.phoneNumber);
        const requestedRecipients = Array.isArray(req.body.recipients) ? req.body.recipients : [];
        const recipientPool = unique((requestedRecipients.length ? requestedRecipients : fallbackRecipients).map(normalizeRecipient));

        if (!recipientPool.length) {
            return res.status(400).json({ error: 'No recipients available to pick a winner.' });
        }

        const winner = recipientPool[Math.floor(Math.random() * recipientPool.length)];
        const message = String(req.body.message || '').trim() || '🎉 Congratulations! You are today\'s winner. Please come by the Twilio booth to claim your prize.';

        const from = getOutboundWhatsappFrom();
        if (!from) {
            return res.status(400).json({ error: 'No outbound WhatsApp sender found. Set TWILIO_WHATSAPP_FROM in .env.' });
        }

        const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
        await twilioClient.messages.create({
            from,
            to: winner,
            body: message
        });

        res.json({
            winner,
            maskedWinner: toMaskedPhone(winner),
            message: 'Winner selected and notified successfully.'
        });
    } catch (error) {
        console.error('Error picking winner:', error);
        res.status(500).json({ error: 'Failed to pick and notify winner' });
    }
});

// Stats page route
router.get('/stats', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'stats.html'));
});

module.exports = router;
