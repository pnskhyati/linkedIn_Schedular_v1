const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 4000;

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/linkup';
mongoose.connect(MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// Models
const AccountSchema = new mongoose.Schema({
    urn: { type: String, required: true, unique: true },
    accessToken: String,
    user: {
        name: String,
        email: String,
        picture: String,
        urn: String
    },
    isActive: { type: Boolean, default: false }
});

const PostSchema = new mongoose.Schema({
    id: String,
    headline: String,
    content: String,
    imageUrl: String,
    hashtags: [String],
    status: { type: String, enum: ['scheduled', 'published', 'failed'], default: 'scheduled' },
    scheduledAt: Date,
    publishedAt: Date,
    linkedinId: String,
    error: String,
    userUrn: String
});

const Account = mongoose.model('Account', AccountSchema);
const Post = mongoose.model('Post', PostSchema);

const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'your-fallback-secret-key';

const allowedOrigins = [
    'https://linked-in-schedular-v1.vercel.app',
    'http://localhost:3000',
    process.env.FRONTEND_URL
].filter(Boolean);

app.use(cookieParser());
app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));
console.log('CORS Allowed Origins:', allowedOrigins);
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// Auth Middleware
const authenticateToken = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Access denied' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userUrn = decoded.urn;
        next();
    } catch (err) {
        res.status(403).json({ error: 'Invalid token' });
    }
};

// Persistence logic replaced by Mongoose models

// --- LinkedIn Auth Routes ---

app.get('/auth/linkedin', (req, res) => {
    const scope = 'w_member_social profile openid email';
    const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(scope)}`;
    res.redirect(authUrl);
});

app.get('/auth/linkedin/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('/?error=no_code');

    try {
        const tokenResponse = await axios.post('https://www.linkedin.com/oauth/v2/accessToken',
            new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                redirect_uri: REDIRECT_URI
            }).toString(),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const accessToken = tokenResponse.data.access_token;

        const profileResponse = await axios.get('https://api.linkedin.com/v2/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const profile = profileResponse.data;
        const personUrn = `urn:li:person:${profile.sub}`;

        const userData = {
            name: profile.name,
            email: profile.email,
            picture: profile.picture,
            urn: personUrn
        };

        // Update or create account in MongoDB
        await Account.findOneAndUpdate(
            { urn: personUrn },
            {
                accessToken,
                user: userData,
                isActive: true
            },
            { upsert: true, new: true }
        );

        // Deactivate others
        // (REMOVED: This was causing session leakage in multi-user environments)

        // Generate JWT
        const token = jwt.sign({ urn: personUrn }, JWT_SECRET, { expiresIn: '7d' });

        // Set Cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: true, // Required for sameSite: 'None'
            sameSite: 'None', // Required for cross-site cookies (Vercel -> Render)
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        res.send(`
            <script>
                window.opener.postMessage({ type: 'LINKEDIN_AUTH_SUCCESS', user: ${JSON.stringify(userData)} }, "*");
                window.close();
            </script>
        `);
    } catch (error) {
        console.error('LinkedIn Auth Error:', error.response?.data || error.message);
        res.send(`<script>window.opener.postMessage({ type: 'LINKEDIN_AUTH_ERROR' }, "*"); window.close();</script>`);
    }
});

app.get('/api/auth/status', authenticateToken, async (req, res) => {
    try {
        const urn = req.userUrn;
        const account = await Account.findOne({ urn });

        res.json({
            connected: !!account,
            user: account ? account.user : null,
            activeUrn: urn
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/auth/accounts', authenticateToken, async (req, res) => {
    try {
        // In a true multi-user system, we might only allow switching within related accounts,
        // but for now, we'll return all for the authenticated user (though LinkedIn only has one per login)
        const accounts = await Account.find({ urn: req.userUrn });
        res.json({ accounts: accounts.map(a => a.user) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/switch', async (req, res) => {
    try {
        const { urn } = req.body;
        const account = await Account.findOne({ urn });
        if (account) {
            await Account.updateMany({}, { isActive: false });
            account.isActive = true;
            await account.save();
            res.json({ success: true, user: account.user });
        } else {
            res.status(404).json({ error: 'Account not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('token', {
        httpOnly: true,
        secure: true,
        sameSite: 'None'
    });
    res.json({ success: true });
});

// --- History & Schedule Sync ---

app.get('/api/history', authenticateToken, async (req, res) => {
    try {
        const urn = req.userUrn;
        const history = await Post.find({ userUrn: urn }).sort({ scheduledAt: -1 });
        res.json({ history });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/history/sync', authenticateToken, async (req, res) => {
    try {
        const urn = req.userUrn;
        const { history } = req.body;
        if (!history) return res.status(400).json({ error: 'History is required' });

        for (const post of history) {
            await Post.findOneAndUpdate(
                { id: post.id, userUrn: urn },
                { ...post, userUrn: urn },
                { upsert: true }
            );
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Publishing Logic ---

async function uploadImageToLinkedIn(base64Image, targetUrn) {
    const account = await Account.findOne({ urn: targetUrn });
    if (!account) {
        throw new Error('LinkedIn account not connected for ' + targetUrn);
    }
    const token = account.accessToken;
    const urn = account.urn;

    try {
        const registerResponse = await axios.post(
            'https://api.linkedin.com/v2/assets?action=registerUpload',
            {
                registerUploadRequest: {
                    recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
                    owner: urn,
                    serviceRelationships: [
                        {
                            relationshipType: 'OWNER',
                            identifier: 'urn:li:userGeneratedContent',
                        },
                    ],
                },
            },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        const uploadUrl = registerResponse.data.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
        const asset = registerResponse.data.value.asset;
        const buffer = Buffer.from(base64Image.split(',')[1], 'base64');

        await axios.put(uploadUrl, buffer, {
            headers: {
                'Content-Type': 'application/octet-stream',
            },
        });

        return asset;
    } catch (error) {
        console.error('LinkedIn Image Upload Error:', error.response?.data || error.message);
        throw error;
    }
}

async function performPublish(post, targetUrn) {
    const account = await Account.findOne({ urn: targetUrn });
    if (!account) throw new Error('Account not found');

    const urn = account.urn;
    const token = account.accessToken;

    let mediaAsset = null;
    if (post.imageUrl && post.imageUrl.startsWith('data:image')) {
        mediaAsset = await uploadImageToLinkedIn(post.imageUrl, targetUrn);
    }

    const shareCommentary = `${post.headline}\n\n${post.content}\n\n${post.hashtags ? post.hashtags.map(tag => `#${tag.replace(/^#/, '')}`).join(' ') : ''}`;

    const publishBody = {
        author: urn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
            'com.linkedin.ugc.ShareContent': {
                shareCommentary: {
                    text: shareCommentary,
                },
                shareMediaCategory: mediaAsset ? 'IMAGE' : 'NONE',
                media: mediaAsset ? [{
                    status: 'READY',
                    description: { text: post.headline },
                    media: mediaAsset,
                    title: { text: post.headline }
                }] : undefined
            },
        },
        visibility: {
            'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
        },
    };

    const response = await axios.post(
        'https://api.linkedin.com/v2/ugcPosts',
        publishBody,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-Restli-Protocol-Version': '2.0.0',
            },
        }
    );

    return response.data.id;
}

app.post('/api/publish/linkedin', authenticateToken, async (req, res) => {
    const { headline, content, imageUrl, hashtags } = req.body;
    const targetUrn = req.userUrn;

    try {
        const postId = await performPublish({ headline, content, imageUrl, hashtags }, targetUrn);
        res.json({
            success: true,
            id: postId,
            url: `https://www.linkedin.com/feed/update/${postId}`
        });
    } catch (error) {
        console.error('LinkedIn Publish Error:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            error: error.response?.data?.message || error.message
        });
    }
});

// --- Background Job ---
setInterval(async () => {
    const now = new Date();
    try {
        const pendingPosts = await Post.find({
            status: 'scheduled',
            scheduledAt: { $lte: now }
        });

        for (const post of pendingPosts) {
            console.log(`[Scheduler] Publishing due post: "${post.headline}" for user ${post.userUrn}`);
            try {
                const postId = await performPublish(post, post.userUrn);
                post.status = 'published';
                post.linkedinId = postId;
                post.publishedAt = new Date();
                await post.save();
                console.log(`[Scheduler] Successfully published: ${postId}`);
            } catch (err) {
                console.error(`[Scheduler] Failed to publish post ${post.id}:`, err.message);
                post.status = 'failed';
                post.error = err.message;
                await post.save();
            }
        }
    } catch (error) {
        console.error('[Scheduler] Error in background job:', error.message);
    }
}, 30000); // Check every 30 seconds

app.post('/api/ai/insights', async (req, res) => {
    const { posts } = req.body;
    const GEMINI_KEY = process.env.GEMINI_API_KEY;

    if (!posts || !Array.isArray(posts)) {
        return res.status(400).json({ error: 'Posts array is required' });
    }

    try {
        const postSummaries = posts.map(p => `- ${p.headline}: ${p.content.substring(0, 50)}...`).join('\n');
        const prompt = `Based on these scheduled LinkedIn posts, provide 3 short "Brand Insights" for the user. 
    Focus on: 1. Content gaps, 2. Tone consistency, 3. Engagement prediction.
    Format your response as a JSON object with a 'summary' string and a 'tips' array of 3 strings.
    Posts:\n${postSummaries}`;

        const aiResponse = await axios.post(
            `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: "application/json" }
            }
        );

        const result = JSON.parse(aiResponse.data.candidates[0].content.parts[0].text);
        res.json(result);
    } catch (error) {
        res.json({
            summary: "Your strategy looks solid! Keep posting consistently to build authority.",
            tips: [
                "Consistent posting builds 3x more trust",
                "Engage with comments in the first hour",
                "Mix educational content with personal stories"
            ]
        });
    }
});

app.get('/', (req, res) => {
    res.send('<h1>LinkUp AI Scheduler Backend</h1><p>Server is running. Access the frontend via Vercel.</p>');
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', server: 'LinkUp Backend' });
});

app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
});
