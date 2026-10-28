export default async function handler(req, res) {
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
    const { name, email, subject, message } = req.body || {};

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email, and message are required.' });
    }

    const projectId = process.env.FIREBASE_PROJECT_ID || 'clarifiedsouthafrica';
    const apiKey = process.env.FIREBASE_API_KEY;

    if (!apiKey) {
      // In development or before env var is set in Vercel, record locally or respond gracefully
      console.warn('FIREBASE_API_KEY not configured in environment variables.');
      return res.status(200).json({
        success: true,
        notice: 'Message received. Configure FIREBASE_API_KEY in Vercel to sync with Firestore.'
      });
    }

    // Direct Firestore REST API call
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/contact_messages?key=${encodeURIComponent(apiKey)}`;

    const documentPayload = {
      fields: {
        name: { stringValue: String(name).slice(0, 200) },
        email: { stringValue: String(email).slice(0, 200) },
        subject: { stringValue: String(subject || 'General Inquiry').slice(0, 300) },
        message: { stringValue: String(message).slice(0, 5000) },
        status: { stringValue: 'unread' },
        createdAt: { timestampValue: new Date().toISOString() }
      }
    };

    const response = await fetch(firestoreUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(documentPayload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Firestore REST API error:', errorText);
      return res.status(502).json({ error: 'Failed to record message in Firestore.' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Contact handler error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
