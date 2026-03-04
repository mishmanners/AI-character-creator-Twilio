const fs = require('fs');
const path = require('path');
const { parsePhoneNumberFromString } = require('libphonenumber-js');

const DATA_DIR = path.join(__dirname, 'output');
const JOB_LOG_FILE = path.join(DATA_DIR, 'jobs.json');

function ensureJobStorage() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(JOB_LOG_FILE)) {
        fs.writeFileSync(JOB_LOG_FILE, JSON.stringify([], null, 2));
    }
}

function readJobLog() {
    ensureJobStorage();
    try {
        const raw = fs.readFileSync(JOB_LOG_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error('Failed to read job log:', error);
        return [];
    }
}

function writeJobLog(entries) {
    ensureJobStorage();
    fs.writeFileSync(JOB_LOG_FILE, JSON.stringify(entries, null, 2));
}

function upsertJob(update) {
    const jobs = readJobLog();
    const index = jobs.findIndex((job) => job.messageSid === update.messageSid);
    if (index >= 0) {
        jobs[index] = {
            ...jobs[index],
            ...update,
            updatedAt: new Date().toISOString()
        };
    } else {
        jobs.push({
            ...update,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
    }
    writeJobLog(jobs);
}

function toMaskedPhone(phoneNumber = '') {
    const cleaned = String(phoneNumber).trim();
    const digits = cleaned.replace(/\D/g, '');

    if (digits.length < 6) {
        return cleaned;
    }

    const local = digits.length >= 10 ? digits.slice(-10) : digits;
    const country = digits.length > 10 ? `+${digits.slice(0, digits.length - 10)} ` : '';
    const areaCode = local.slice(0, 3);
    const lastThree = local.slice(-3);
    return `${country}(${areaCode}) ******${lastThree}`;
}

function parsePhoneParts(phoneNumber = '') {
    const cleaned = String(phoneNumber).trim().replace(/^whatsapp:/, '');
    const parsed = parsePhoneNumberFromString(cleaned);

    if (parsed) {
        const nationalNumber = String(parsed.nationalNumber || '');
        return {
            countryCode: String(parsed.countryCallingCode || 'unknown'),
            countryIso: parsed.country || 'unknown',
            areaCode: nationalNumber.slice(0, 3) || 'unknown'
        };
    }

    const digits = cleaned.replace(/\D/g, '');
    if (digits.length < 6) {
        return {
            countryCode: 'unknown',
            countryIso: 'unknown',
            areaCode: 'unknown'
        };
    }

    const local = digits.length >= 10 ? digits.slice(-10) : digits;
    const countryDigits = digits.length > 10 ? digits.slice(0, digits.length - 10) : '1';
    return {
        countryCode: countryDigits || 'unknown',
        countryIso: 'unknown',
        areaCode: local.slice(0, 3) || 'unknown'
    };
}

function geographyLabelFromPhone(phoneNumber = '') {
    const { countryCode, countryIso, areaCode } = parsePhoneParts(phoneNumber);

    let countryLabel = `Country +${countryCode}`;
    if (countryIso && countryIso !== 'unknown') {
        try {
            const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
            countryLabel = regionNames.of(countryIso) || countryLabel;
        } catch (error) {
            countryLabel = `Country +${countryCode}`;
        }
    } else if (countryCode === '1') {
        countryLabel = 'United States/Canada';
    }

    if (countryCode === '1' && areaCode !== 'unknown') {
        return `${countryLabel} (+${countryCode}, Area ${areaCode})`;
    }

    return `${countryLabel} (+${countryCode})`;
}

function unique(values) {
    return [...new Set(values.filter(Boolean))];
}

function normalizeRecipient(number) {
    const trimmed = String(number || '').trim();
    if (!trimmed) {
        return '';
    }
    return trimmed.startsWith('whatsapp:') ? trimmed : `whatsapp:${trimmed}`;
}

function getOutboundWhatsappFrom() {
    if (process.env.TWILIO_WHATSAPP_FROM) {
        return normalizeRecipient(process.env.TWILIO_WHATSAPP_FROM);
    }
    if (process.env.WHATSAPP_FROM) {
        return normalizeRecipient(process.env.WHATSAPP_FROM);
    }

    const jobs = readJobLog();
    const recentWithTo = jobs
        .filter((job) => !!job.to)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    return recentWithTo.length > 0 ? recentWithTo[0].to : null;
}

module.exports = {
    ensureJobStorage,
    readJobLog,
    writeJobLog,
    upsertJob,
    toMaskedPhone,
    parsePhoneParts,
    geographyLabelFromPhone,
    unique,
    normalizeRecipient,
    getOutboundWhatsappFrom
};
