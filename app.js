const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const mongodb = require('mongodb');
const fs = require('fs');
const multer = require('multer');
const session = require('express-session');
const cors=require('cors');


const app = express();
const port = 3001;
app.use(cors());

// MongoDB connection
const MongoClient = mongodb.MongoClient;
const url = 'mongodb+srv://praveenkumartv1:12345@praveendb.ac0h0.mongodb.net/';
const dbName = 'tjesdt';
let db;

// Connect to MongoDB
MongoClient.connect(url, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(client => {
        db = client.db(dbName);
        console.log('Connected to MongoDB');
    })
    .catch(error => console.error(error));


// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(session({ 
    secret: 'your-secret-key', 
    resave: false, 
    saveUninitialized: true,
    cookie: { maxAge: 3600000 } // 1 hour
}));


const transporter=nodemailer.createTransport({
    service:'gmail',
    auth:{
        user:'buildclubtce@gmail.com',
        pass:'mjfk wwoo jtmo tcmt'
    }
});



// Define the path to the seqno file
const seqnoFilePath = path.join(__dirname, 'seqno.txt');

// Function to read the current seqno from the file
function readSeqno() {
    try {
        const data = fs.readFileSync(seqnoFilePath, 'utf8');
        return parseInt(data) || 1; // Default to 1 if the file is empty or corrupted
    } catch (error) {
        return 1; // Default to 1 if the file doesn't exist or can't be read
    }
}

// Function to save the new seqno to the file
function writeSeqno(seqno) {
    fs.writeFileSync(seqnoFilePath, seqno.toString(), 'utf8');
}

// Initialize seqno from the file
let seqno = readSeqno();
let fileName;
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const currentYear = new Date().getFullYear();
        filename = `TJESDT-${currentYear}-${seqno}`;
        
        // Increment seqno for the next upload and save to the file
        seqno++;
        writeSeqno(seqno);

        cb(null, filename);
    }
});

const upload = multer({ storage: storage });



// Routes

// Serve the login page
app.get('/', (req, res) => {
    // Check if user is already logged in
    if (req.session.user) {
        return res.redirect(`/profile/${req.session.user._id}`);
    }
    res.sendFile(path.join(__dirname, 'public'));
});
let user_email;
// Handle user login - updated to return userId for redirection
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        user_email=email;
        // Find user by email
        const user = await db.collection('users').findOne({ email: email });
        
        // Check if user exists and password matches
        if (user && user.password === password) {
            // Store user in session but remove sensitive data
            const sessionUser = {
                _id: user._id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                contact: user.contact,
                field: user.field,
                department: user.department,
                designation: user.designation,
                institution: user.institution,
                address: user.address
            };
            
            req.session.user = sessionUser;
            res.json({ 
                success: true, 
                userId: user._id.toString() // Return userId to redirect to profile page
            });
        } else {
            // Authentication failed
            res.json({ success: false });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Logout route
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Serve the profile page with user-specific ID parameter
app.get('/profile/:userId', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');  // Redirect to login if not authenticated
    }
    
    // Check if the user is trying to access their own profile
    if (req.session.user._id.toString() === req.params.userId) {
        res.sendFile(path.join(__dirname, 'public', 'profile.html'));
    } else {
        // If trying to access another user's profile, redirect to their own profile
        res.redirect(`/profile/${req.session.user._id}`);
    }
});

// Legacy profile route - redirect to ID-based route
app.get('/profile', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');  // Redirect to login if not authenticated
    }
    res.redirect(`/profile/${req.session.user._id}`);
});

// Get specific user profile information
app.get('/api/profile/:userId', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).send('Unauthorized');
    }
    
    try {
        // If user is requesting their own profile, use session data (faster)
        if (req.session.user._id.toString() === req.params.userId) {
            return res.json(req.session.user);
        }
        
        // Otherwise fetch the requested user from database (with permission checks if needed)
        const userId = new mongodb.ObjectId(req.params.userId);
        const user = await db.collection('users').findOne(
            { _id: userId },
            { projection: { password: 0 } } // Exclude password from the result
        );
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        res.json(user);
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Legacy get-profile endpoint - for backward compatibility
app.get('/get-profile', (req, res) => {
    if (!req.session.user) {
        return res.status(401).send('Unauthorized');
    }
    res.json(req.session.user);
});

// Upload journal
let filemsg="TJESDT-";
filemsg+=(new Date().getFullYear().toString());
filemsg+='-';
filemsg+=seqno.toString();
console.log(filemsg);
app.post('/upload-journal', upload.single('journalFile'), async (req, res) => {
    if (!req.session.user) {
        return res.status(401).send('Unauthorized');
    }

    try {
        const { journalTitle, journalAbstract, authors } = req.body;
        const journalFile = req.file;

        // Parse authors JSON string to an array
        const parsedAuthors = JSON.parse(authors);

        if (!journalFile) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const journal = {
            name: journalTitle,
            abstract: journalAbstract,
            authors: parsedAuthors,  // Now storing authors correctly as an array
            filePath: journalFile.path,  // Store the file path
            fileName: journalFile.originalname, // Store original filename
            uploadedBy: req.session.user._id, // Link journal to user
            uploadDate: new Date()
        };

        await db.collection('journals').insertOne(journal);
        const mailOptions = {
            from: 'buildclubtce@gmail.com',
            to: user_email,
            subject: 'Journal Submission Successful',
            text: `Your paper "${journal.name}" has been submitted successfully.\n\n` +
                  `Paper code-${filemsg}\n`+
                  `Details of the submission:\n` +
                  `Paper Title: ${journal.name}\n` +
                  `Authors: ${journal.authors.map(author => `${author.firstname} ${author.lastname}, ${author.designation}, ${author.institution}`).join('; ')}\n` +
                  `Upload Date: ${journal.uploadDate.toLocaleString()}\n\n` +
                  `With Regards,\nTJESDT`
        };
        
        try{
            const info=await transporter.sendMail(mailOptions);
            console.log("Email sent successfully for submission "+info.response);
            //res.status(201).send("Paper submitted");
        }catch(error){
            console.error("Error occured in sendig email "+error);
        }
        res.json({ success: true, message: 'Journal submitter successfully.Check mail for further details' });
        
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ success: false, message: 'Failed to save journal information' });
    }
});

// Get all journals
app.get('/get-journals', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).send('Unauthorized');
    }
    
    try {
        // Option 1: Get all journals
        const journals = await db.collection('journals').find().toArray();
        
        // Option 2: Get only user's journals (uncomment if you prefer this)
        // const userId = req.session.user._id;
        // const journals = await db.collection('journals').find({ uploadedBy: userId }).toArray();
        
        res.json(journals);
    } catch (error) {
        console.error('Error fetching journals:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch journals' });
    }
});

// Download journal file by journal ID
app.get('/download/:journalId', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).send('Unauthorized');
    }
    
    try {
        const journalId = new mongodb.ObjectId(req.params.journalId);
        const journal = await db.collection('journals').findOne({ _id: journalId });
        
        if (journal && journal.filePath) {
            res.download(journal.filePath, journal.fileName || 'journal-file');
        } else {
            res.status(404).send('Journal not found');
        }
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).send('Error downloading file');
    }
});
app.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ message: 'Logout failed' });
        }
        res.clearCookie('connect.sid'); // Clears session cookie
        res.status(200).json({ message: 'Logged out successfully' });
    });
});


// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});