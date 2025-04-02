const express = require('express');
const cors = require('cors');
const { initializeApp } = require('firebase/app');
const { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } = require('firebase/auth');
const { getDatabase, ref, set, get, push, remove, update } = require('firebase/database');
const admin = require('firebase-admin');
const dotenv = require('dotenv');
const axios = require('axios');
const path = require('path');

dotenv.config();

// Initialize Firebase
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getDatabase(firebaseApp);

// Initialize Firebase Admin (for token verification)
admin.initializeApp({
    credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL
});

// Express app setup
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to verify Firebase authentication
const verifyToken = async (req, res, next) => {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) {
        return res.status(401).json({ error: "Unauthorized. No token provided." });
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error("Error verifying token:", error);
        res.status(401).json({ error: "Invalid authentication token." });
    }
};

// Register user
app.post('/register', async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed. Use POST for registration.' });
    }
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        // Create user profile in database
        await set(ref(db, 'users/' + user.uid), {
            email: user.email,
            createdAt: new Date().toISOString()
        });
        
        res.status(201).json({ 
            message: 'User registered successfully', 
            user: { uid: user.uid, email: user.email } 
        });
    } catch (error) {
        console.error('Error registering user:', error);
        let errorMessage = 'Registration failed';
        if (error.code === 'auth/email-already-in-use') {
            errorMessage = 'Email address is already in use.';
        }
        res.status(400).json({ error: errorMessage });
    }
});

// Login user
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }

    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        const token = await user.getIdToken();
        
        res.json({
            message: "Logged in successfully",
            user: {
                uid: user.uid,
                email: user.email
            },
            token: token
        });
    } catch (error) {
        console.error("Error logging in:", error);
        let errorMessage = 'Login failed';
        if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
            errorMessage = 'Invalid email or password.';
        }
        res.status(401).json({ error: errorMessage });
    }
});

// Book search using Google Books API
app.get('/api/search-book/:title', verifyToken, async (req, res) => {
    const title = req.params.title;
    const apiUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(title)}&maxResults=10`;

    try {
        const response = await axios.get(apiUrl);
        const data = response.data;
        
        if (!data.items || data.items.length === 0) {
            return res.status(404).json({ error: 'No books found' });
        }
        
        const books = data.items.map(item => {
            const volumeInfo = item.volumeInfo;
            return {
                id: item.id,
                title: volumeInfo.title,
                author: volumeInfo.authors ? volumeInfo.authors.join(', ') : 'Unknown',
                publishedYear: volumeInfo.publishedDate ? volumeInfo.publishedDate.substring(0, 4) : 'Unknown',
                description: volumeInfo.description || 'No description available',
                publisher: volumeInfo.publisher,
                isbn: volumeInfo.industryIdentifiers ? 
                    volumeInfo.industryIdentifiers[0].identifier : 'Unknown',
                genres: volumeInfo.categories || [],
                thumbnail: volumeInfo.imageLinks ? volumeInfo.imageLinks.thumbnail : null
            };
        });
        
        // Log search in user history
        const userId = req.user.uid;
        const searchRef = ref(db, `users/${userId}/searchHistory`);
        await push(searchRef, {
            query: title,
            timestamp: new Date().toISOString()
        });
        
        res.json({ books });
    } catch (error) {
        console.error('Error fetching books:', error);
        res.status(500).json({ error: 'Failed to fetch book details' });
    }
});

// Get book details
app.get('/api/book-details/:bookId', verifyToken, async (req, res) => {
    const bookId = req.params.bookId;
    const apiUrl = `https://www.googleapis.com/books/v1/volumes/${bookId}`;

    try {
        const response = await axios.get(apiUrl);
        const item = response.data;
        const volumeInfo = item.volumeInfo;
        
        const book = {
            id: item.id,
            title: volumeInfo.title,
            author: volumeInfo.authors ? volumeInfo.authors.join(', ') : 'Unknown',
            publishedYear: volumeInfo.publishedDate ? volumeInfo.publishedDate.substring(0, 4) : 'Unknown',
            description: volumeInfo.description || 'No description available',
            publisher: volumeInfo.publisher || 'Unknown',
            isbn: volumeInfo.industryIdentifiers ? 
                volumeInfo.industryIdentifiers[0].identifier : 'Unknown',
            genres: volumeInfo.categories || [],
            pageCount: volumeInfo.pageCount || 'Unknown',
            language: volumeInfo.language || 'Unknown',
            thumbnail: volumeInfo.imageLinks ? volumeInfo.imageLinks.thumbnail : null,
            previewLink: volumeInfo.previewLink || null
        };
        
        res.json(book);
    } catch (error) {
        console.error('Error fetching book details:', error);
        res.status(500).json({ error: 'Failed to fetch book details' });
    }
});

// Get books by category
app.get('/api/books-by-category/:category', verifyToken, async (req, res) => {
    const category = req.params.category;
    const apiUrl = `https://www.googleapis.com/books/v1/volumes?q=subject:${encodeURIComponent(category)}&maxResults=10`;

    try {
        const response = await axios.get(apiUrl);
        const data = response.data;
        
        if (!data.items || data.items.length === 0) {
            return res.status(404).json({ error: 'No books found in this category' });
        }
        
        const books = data.items.map(item => {
            const volumeInfo = item.volumeInfo;
            return {
                id: item.id,
                title: volumeInfo.title,
                author: volumeInfo.authors ? volumeInfo.authors.join(', ') : 'Unknown',
                publishedYear: volumeInfo.publishedDate ? volumeInfo.publishedDate.substring(0, 4) : 'Unknown',
                description: volumeInfo.description || 'No description available',
                thumbnail: volumeInfo.imageLinks ? volumeInfo.imageLinks.thumbnail : null
            };
        });
        
        res.json({ books });
    } catch (error) {
        console.error('Error fetching books by category:', error);
        res.status(500).json({ error: 'Failed to fetch books' });
    }
});

// Save book to user's reading list
app.post('/api/save-book', verifyToken, async (req, res) => {
    const { bookId } = req.body;
    const userId = req.user.uid;
    
    if (!bookId) {
        return res.status(400).json({ error: 'Book ID is required' });
    }
    
    try {
        // Fetch book details from Google Books API
        const apiUrl = `https://www.googleapis.com/books/v1/volumes/${bookId}`;
        const response = await axios.get(apiUrl);
        const item = response.data;
        const volumeInfo = item.volumeInfo;
        
        const book = {
            id: item.id,
            title: volumeInfo.title,
            author: volumeInfo.authors ? volumeInfo.authors.join(', ') : 'Unknown',
            publishedYear: volumeInfo.publishedDate ? volumeInfo.publishedDate.substring(0, 4) : 'Unknown',
            description: volumeInfo.description || 'No description available',
            thumbnail: volumeInfo.imageLinks ? volumeInfo.imageLinks.thumbnail : null,
            addedAt: new Date().toISOString(),
            readStatus: 'not_started'
        };
        
        // Save to user's reading list
        await set(ref(db, `users/${userId}/books/${bookId}`), book);
        
        res.json({ message: 'Book saved to your reading list', book });
    } catch (error) {
        console.error('Error saving book:', error);
        res.status(500).json({ error: 'Failed to save book' });
    }
});

// Get user's saved books
app.get('/api/my-books', verifyToken, async (req, res) => {
    const userId = req.user.uid;
    
    try {
        const booksRef = ref(db, `users/${userId}/books`);
        const snapshot = await get(booksRef);
        
        if (!snapshot.exists()) {
            return res.json({ books: [] });
        }
        
        const booksData = snapshot.val();
        const books = Object.values(booksData);
        
        res.json({ books });
    } catch (error) {
        console.error('Error fetching user books:', error);
        res.status(500).json({ error: 'Failed to fetch your books' });
    }
});

// Update book reading status
app.post('/api/update-book-status', verifyToken, async (req, res) => {
    const { bookId, status } = req.body;
    const userId = req.user.uid;
    
    if (!bookId || !status) {
        return res.status(400).json({ error: 'Book ID and status are required' });
    }
    
    const validStatuses = ['not_started', 'in_progress', 'completed', 'on_hold'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }
    
    try {
        const bookRef = ref(db, `users/${userId}/books/${bookId}`);
        await update(bookRef, { 
            readStatus: status,
            updatedAt: new Date().toISOString()
        });
        
        res.json({ message: 'Reading status updated successfully' });
    } catch (error) {
        console.error('Error updating book status:', error);
        res.status(500).json({ error: 'Failed to update reading status' });
    }
});

// Remove book from user's reading list
app.post('/api/remove-book', verifyToken, async (req, res) => {
    const { bookId } = req.body;
    const userId = req.user.uid;
    
    if (!bookId) {
        return res.status(400).json({ error: 'Book ID is required' });
    }
    
    try {
        const bookRef = ref(db, `users/${userId}/books/${bookId}`);
        await remove(bookRef);
        
        res.json({ message: 'Book removed from your reading list' });
    } catch (error) {
        console.error('Error removing book:', error);
        res.status(500).json({ error: 'Failed to remove book' });
    }
});

// User reading statistics
app.get('/api/reading-stats', verifyToken, async (req, res) => {
    const userId = req.user.uid;
    
    try {
        const booksRef = ref(db, `users/${userId}/books`);
        const snapshot = await get(booksRef);
        
        if (!snapshot.exists()) {
            return res.json({
                totalBooks: 0,
                completed: 0,
                inProgress: 0,
                notStarted: 0,
                onHold: 0
            });
        }
        
        const booksData = snapshot.val();
        const books = Object.values(booksData);
        
        const stats = {
            totalBooks: books.length,
            completed: books.filter(book => book.readStatus === 'completed').length,
            inProgress: books.filter(book => book.readStatus === 'in_progress').length,
            notStarted: books.filter(book => book.readStatus === 'not_started').length,
            onHold: books.filter(book => book.readStatus === 'on_hold').length
        };
        
        res.json(stats);
    } catch (error) {
        console.error('Error fetching reading stats:', error);
        res.status(500).json({ error: 'Failed to fetch reading statistics' });
    }
});

// Serve HTML pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/books', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'books.html'));
});

// Start the server
const PORT = process.env.PORT || 5500;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
