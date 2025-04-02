import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";

// Firebase Configuration (Replace with your actual config)
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

document.addEventListener('DOMContentLoaded', () => {
    // Function to get the ID token
    const getIdToken = async () => {
        try {
            const user = auth.currentUser;
            if (user) {
                return await user.getIdToken();
            }
            return null;
        } catch (error) {
            console.error('Error getting ID token:', error);
            return null;
        }
    };

    // Function to fetch book data with authorization
    const fetchBookData = async (url, options = {}) => {
        const token = await getIdToken();
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };
        const config = {
            ...options,
            headers: headers
        };
        const response = await fetch(url, config);
        return response.json();
    };

    // Check authentication state on the book interaction page
    if (window.location.pathname === '/books') {
        getIdToken().then(token => {
            if (!token) {
                window.location.href = '/login';
            } else {
                console.log('User is logged in (client-side)');
                
                // Book search functionality
                const searchBookBtn = document.getElementById('searchBookBtn');
                const bookInput = document.getElementById('bookInput');
                const bookResultsDiv = document.getElementById('bookResults');
                
                if (searchBookBtn) {
                    searchBookBtn.addEventListener('click', async () => {
                        const bookTitle = bookInput.value;
                        if (bookTitle) {
                            bookResultsDiv.innerHTML = '<p>Searching...</p>';
                            try {
                                const data = await fetchBookData(`/api/search-book/${encodeURIComponent(bookTitle)}`);
                                
                                if (data.books && data.books.length > 0) {
                                    let resultsHTML = '<div class="book-list">';
                                    data.books.forEach(book => {
                                        resultsHTML += `
                                            <div class="book-item">
                                                <h3>${book.title}</h3>
                                                <p><strong>Author:</strong> ${book.author}</p>
                                                <p><strong>Published:</strong> ${book.publishedYear || 'Unknown'}</p>
                                                <p>${book.description?.substring(0, 150) || 'No description available'}${book.description?.length > 150 ? '...' : ''}</p>
                                                <div class="book-actions">
                                                    <button class="details-btn" data-id="${book.id}">View Details</button>
                                                    <button class="save-btn" data-id="${book.id}">Save to List</button>
                                                </div>
                                            </div>
                                        `;
                                    });
                                    resultsHTML += '</div>';
                                    bookResultsDiv.innerHTML = resultsHTML;
                                    
                                    // Add event listeners to newly created buttons
                                    document.querySelectorAll('.details-btn').forEach(btn => {
                                        btn.addEventListener('click', async (e) => {
                                            const bookId = e.target.getAttribute('data-id');
                                            const bookDetails = await fetchBookData(`/api/book-details/${bookId}`);
                                            displayBookDetails(bookDetails);
                                        });
                                    });
                                    
                                    document.querySelectorAll('.save-btn').forEach(btn => {
                                        btn.addEventListener('click', async (e) => {
                                            const bookId = e.target.getAttribute('data-id');
                                            await fetchBookData('/api/save-book', {
                                                method: 'POST',
                                                body: JSON.stringify({ bookId })
                                            });
                                            showNotification('Book saved to your list!');
                                        });
                                    });
                                } else {
                                    bookResultsDiv.innerHTML = '<p>No books found. Try a different search term.</p>';
                                }
                            } catch (error) {
                                console.error('Error searching for books:', error);
                                bookResultsDiv.innerHTML = '<p>An error occurred while searching. Please try again.</p>';
                            }
                        } else {
                            bookResultsDiv.innerHTML = '<p>Please enter a book title or author name.</p>';
                        }
                    });
                }
                
                // Book category selection
                const categorySelect = document.getElementById('categorySelect');
                if (categorySelect) {
                    categorySelect.addEventListener('change', async () => {
                        const category = categorySelect.value;
                        if (category) {
                            try {
                                const data = await fetchBookData(`/api/books-by-category/${category}`);
                                // Display results using the same format as search results
                                if (data.books && data.books.length > 0) {
                                    // Similar code to display books as in the search function
                                    // ...
                                }
                            } catch (error) {
                                console.error('Error fetching books by category:', error);
                            }
                        }
                    });
                }
                
                // My book list functionality
                const myBooksBtn = document.getElementById('myBooksBtn');
                if (myBooksBtn) {
                    myBooksBtn.addEventListener('click', async () => {
                        try {
                            const data = await fetchBookData('/api/my-books');
                            const myBooksDiv = document.getElementById('myBooks');
                            
                            if (data.books && data.books.length > 0) {
                                let booksHTML = '<h2>My Books</h2><div class="book-list">';
                                data.books.forEach(book => {
                                    booksHTML += `
                                        <div class="book-item">
                                            <h3>${book.title}</h3>
                                            <p><strong>Author:</strong> ${book.author}</p>
                                            <p><strong>Status:</strong> ${book.readStatus || 'Not started'}</p>
                                            <div class="book-actions">
                                                <button class="status-btn" data-id="${book.id}">Update Status</button>
                                                <button class="remove-btn" data-id="${book.id}">Remove</button>
                                            </div>
                                        </div>
                                    `;
                                });
                                booksHTML += '</div>';
                                myBooksDiv.innerHTML = booksHTML;
                                
                                // Add status update functionality
                                document.querySelectorAll('.status-btn').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        const bookId = e.target.getAttribute('data-id');
                                        showStatusUpdateDialog(bookId);
                                    });
                                });
                                
                                // Add remove book functionality
                                document.querySelectorAll('.remove-btn').forEach(btn => {
                                    btn.addEventListener('click', async (e) => {
                                        const bookId = e.target.getAttribute('data-id');
                                        if (confirm('Are you sure you want to remove this book from your list?')) {
                                            await fetchBookData('/api/remove-book', {
                                                method: 'POST',
                                                body: JSON.stringify({ bookId })
                                            });
                                            e.target.closest('.book-item').remove();
                                            showNotification('Book removed from your list');
                                        }
                                    });
                                });
                            } else {
                                myBooksDiv.innerHTML = '<p>You have no saved books yet.</p>';
                            }
                        } catch (error) {
                            console.error('Error fetching my books:', error);
                        }
                    });
                }

                // Helper function to display book details
                function displayBookDetails(book) {
                    const detailsModal = document.getElementById('bookDetailsModal') || createDetailsModal();
                    const modalContent = detailsModal.querySelector('.modal-content');
                    
                    modalContent.innerHTML = `
                        <span class="close-modal">&times;</span>
                        <h2>${book.title}</h2>
                        <p><strong>Author:</strong> ${book.author}</p>
                        <p><strong>Published:</strong> ${book.publishedYear || 'Unknown'}</p>
                        <p><strong>Publisher:</strong> ${book.publisher || 'Unknown'}</p>
                        <p><strong>Genre:</strong> ${book.genres?.join(', ') || 'Not specified'}</p>
                        <p><strong>ISBN:</strong> ${book.isbn || 'Not available'}</p>
                        <div class="book-description">
                            <h3>Description</h3>
                            <p>${book.description || 'No description available'}</p>
                        </div>
                        <button id="addToReadingList" data-id="${book.id}">Add to Reading List</button>
                    `;
                    
                    detailsModal.style.display = 'block';
                    
                    // Close modal functionality
                    const closeBtn = detailsModal.querySelector('.close-modal');
                    closeBtn.addEventListener('click', () => {
                        detailsModal.style.display = 'none';
                    });
                    
                    // Add to reading list functionality
                    const addBtn = document.getElementById('addToReadingList');
                    addBtn.addEventListener('click', async () => {
                        const bookId = addBtn.getAttribute('data-id');
                        await fetchBookData('/api/save-book', {
                            method: 'POST',
                            body: JSON.stringify({ bookId })
                        });
                        detailsModal.style.display = 'none';
                        showNotification('Book added to your reading list!');
                    });
                }
                
                // Helper function to create details modal if it doesn't exist
                function createDetailsModal() {
                    const modal = document.createElement('div');
                    modal.id = 'bookDetailsModal';
                    modal.className = 'modal';
                    modal.innerHTML = '<div class="modal-content"></div>';
                    document.body.appendChild(modal);
                    return modal;
                }
                
                // Helper function to show status update dialog
                function showStatusUpdateDialog(bookId) {
                    const statusModal = document.getElementById('statusModal') || createStatusModal();
                    statusModal.style.display = 'block';
                    
                    const updateBtn = document.getElementById('updateStatusBtn');
                    updateBtn.setAttribute('data-id', bookId);
                    
                    // Close modal functionality
                    const closeBtn = statusModal.querySelector('.close-modal');
                    closeBtn.addEventListener('click', () => {
                        statusModal.style.display = 'none';
                    });
                    
                    // Update status functionality
                    updateBtn.addEventListener('click', async () => {
                        const status = document.getElementById('readingStatus').value;
                        await fetchBookData('/api/update-book-status', {
                            method: 'POST',
                            body: JSON.stringify({ bookId, status })
                        });
                        statusModal.style.display = 'none';
                        showNotification('Reading status updated!');
                        // Refresh books list to show updated status
                        document.getElementById('myBooksBtn').click();
                    });
                }
                
                // Helper function to create status modal if it doesn't exist
                function createStatusModal() {
                    const modal = document.createElement('div');
                    modal.id = 'statusModal';
                    modal.className = 'modal';
                    modal.innerHTML = `
                        <div class="modal-content">
                            <span class="close-modal">&times;</span>
                            <h2>Update Reading Status</h2>
                            <select id="readingStatus">
                                <option value="not_started">Not Started</option>
                                <option value="in_progress">Currently Reading</option>
                                <option value="completed">Completed</option>
                                <option value="on_hold">On Hold</option>
                            </select>
                            <button id="updateStatusBtn">Update</button>
                        </div>
                    `;
                    document.body.appendChild(modal);
                    return modal;
                }
                
                // Helper function to show notification
                function showNotification(message) {
                    const notification = document.createElement('div');
                    notification.className = 'notification';
                    notification.textContent = message;
                    document.body.appendChild(notification);
                    
                    // Remove notification after 3 seconds
                    setTimeout(() => {
                        notification.remove();
                    }, 3000);
                }

                // Logout functionality
                const logoutButton = document.getElementById('logoutBtn');
                if (logoutButton) {
                    logoutButton.addEventListener('click', async () => {
                        try {
                            await signOut(auth);
                            console.log('User logged out');
                            window.location.href = '/login';
                        } catch (error) {
                            console.error('Error logging out:', error);
                        }
                    });
                }
            }
        });
    }

    // Registration Form Handling (if on register.html)
    const registerForm = document.getElementById('registerForm');
    const registerMessageDiv = document.getElementById('registerMessage');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const telegramUsername = registerForm.telegramUsername.value;
            const telegramID = registerForm.telegramID.value;

            try {
                const response = await fetch('/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ telegramUsername, telegramID })
                });
                const data = await response.json();
                if (response.ok) {
                    registerMessageDiv.textContent = data.message;
                    registerMessageDiv.style.color = 'green';
                    registerForm.reset();
                    window.location.href = '/login';
                } else {
                    registerMessageDiv.textContent = data.error;
                    registerMessageDiv.style.color = 'red';
                }
            } catch (error) {
                console.error('Error registering:', error);
                registerMessageDiv.textContent = 'An error occurred during registration.';
                registerMessageDiv.style.color = 'red';
            }
        });
    }

    // Login Form Handling (if on login.html)
    const loginForm = document.getElementById('loginForm');
    const loginMessageDiv = document.getElementById('loginMessage');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const telegramUsername = loginForm.telegramUsername.value;
            const telegramID = loginForm.telegramID.value;

            try {
                const response = await fetch('/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ telegramUsername, telegramID })
                });
                const data = await response.json();
                if (response.ok) {
                    loginMessageDiv.textContent = data.message;
                    loginMessageDiv.style.color = 'green';
                    loginForm.reset();
                    // Store the token and redirect
                    localStorage.setItem('authToken', data.token);
                    window.location.href = '/books';
                } else {
                    loginMessageDiv.textContent = data.error;
                    loginMessageDiv.style.color = 'red';
                }
            } catch (error) {
                console.error('Error logging in:', error);
                loginMessageDiv.textContent = 'An error occurred during login.';
                loginMessageDiv.style.color = 'red';
            }
        });
    }
});
