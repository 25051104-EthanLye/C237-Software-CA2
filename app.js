const express = require('express');
const mysql = require('mysql2');
const flash = require('connect-flash');
const session = require('express-session');

const app = express();

app.set('view engine', 'ejs');

const db = mysql.createConnection({
    host: 'c237-yewyih-mysql.mysql.database.azure.com',
    user: 'c237_006',
    password: 'c237006@2026!',
    database: 'c237_006_ca2_db1',
    ssl: {}
});

db.connect((err) => {
    if (err) throw err;
    console.log('Connected to database');
});

app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));

app.use(session({
    secret: 'my_super_secret_key', 
    resave: false,
    saveUninitialized: false
}));

app.use(flash());

// --- REGISTRATION VALIDATION MIDDLEWARE ---
const validateRegistration = (req, res, next) => {
    const { username, email, password, contact } = req.body;

    if (!username || !email || !password || !contact) {
        req.flash('error', 'All fields are required.');
        return res.render('register', { messages: req.flash('error'), formData: req.body });
    }

    if (password.length < 6) {
        req.flash('error', 'Password must be at least 6 characters long.');
        return res.render('register', { messages: req.flash('error'), formData: req.body });
    }

    next(); 
};

// --- AUTHENTICATION MIDDLEWARE ---
const isAuthenticated = (req, res, next) => {
    if (!req.session.user) {
        req.flash('error', 'Please log in to access this page.');
        return res.redirect('/');
    }

    next();
};

// --- PATHS --- //

// 1. HOME ROUTE
app.get('/', (req, res) => {
    res.render('index', { 
        user: req.session.user, 
        messages: req.flash('success'),
        errors: req.flash('error') // Catches failed login attempts to trigger the modal
    });
});

// 2. REGISTER GET ROUTE
app.get('/register', (req, res) => {
    res.render('register', { messages: req.flash('error'), formData: {} });
});

// 3. REGISTER POST ROUTE
app.post('/register', validateRegistration, (req, res) => {
    const { username, email, password, contact } = req.body; 

    const checkSql = 'SELECT * FROM users WHERE username = ? OR email = ?';
    
    db.query(checkSql, [username, email], (err, results) => {
        if (err) throw err;

        if (results.length > 0) {
            let errorMsg = 'That account already exists.';
            if (results[0].username === username) {
                errorMsg = 'That username is already taken. Please choose another one.';
            } else if (results[0].email === email) {
                errorMsg = 'That email is already registered. Please log in instead.';
            }

            req.flash('error', errorMsg);
            return res.render('register', { 
                messages: req.flash('error'), 
                formData: { username: '', email: '', contact } 
            });
        }

        const insertSql = 'INSERT INTO users (username, email, contact, password, role, account_status) VALUES (?, ?, ?, SHA1(?), ?, ?)';
        
        db.query(insertSql, [username, email, contact, password, 'user', 'active'], (err, result) => {
            if (err) throw err;
            
            console.log("New unique user created successfully!");
            
            // Sends the success message to the homepage so the modal instantly pops open!
            req.flash('success', 'Registration successful! Please log in.');
            res.redirect('/'); 
        });
    });
});

// 4. LOGIN POST ROUTE (Triggered by the Navbar Modal)
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/'); 
    }
    
    const sql = 'SELECT * FROM users WHERE email = ? AND password = SHA1(?)';
    db.query(sql, [email, password], (err, results) => {
        if (err) throw err;
        
        if (results.length > 0) {
            // Success! Create session and reload the page to display the profile button
            req.session.user = results[0]; 
            res.redirect('/'); 
        } else {
            // Failure! Redirect to home with an error, triggering the modal to pop open again
            req.flash('error', 'Invalid email or password.');
            res.redirect('/'); 
        }
    });
});

// 5. LOGOUT ROUTE
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});


// 6. ITINERARY ROUTE 
app.get('/itinerary', isAuthenticated, (req, res) => {

    const userId = req.session.user.userId;

    const sql = "SELECT * FROM itineraries WHERE userId = ?";

    db.query(sql, [userId], (err, results) => {
        if (err) {
            console.log(err);
            return res.send("Database Error");
        }

        res.render("itinerary", {
            itineraries: results
        });
    });

});

// Save itinerary route 
app.post('/itinerary/add', isAuthenticated, (req, res) => {

    const { location, country, visitDate, notes } = req.body;
    const userId = req.session.user.userId;

    const sql = `
    INSERT INTO itineraries
    (userId, location, country, visitDate, notes)
    VALUES (?, ?, ?, ?, ?)
    `;

    db.query(
        sql,
        [userId, location, country, visitDate, notes],
        (err, result) => {

            if (err) {
                console.log(err);
                return res.send("Database Error");
            }

            res.redirect("/itinerary");
        }
    );

});
// Add location page
app.get('/itinerary/add', isAuthenticated, (req, res) => {
    res.render('addLocation');
});

// Show Edit Form
app.get('/itinerary/edit/:id', isAuthenticated, (req, res) => {

    const id = req.params.id;

    const sql = "SELECT * FROM itineraries WHERE itineraryId = ?";

    db.query(sql, [id], (err, results) => {

        if (err) {
            console.log(err);
            return res.send("Database Error");
        }

        if (results.length === 0) {
            return res.send("Itinerary not found");
        }

        res.render("editLocation", {
            itinerary: results[0]
        });

    });

});

// Update itinerary route
app.post('/itinerary/edit/:id', isAuthenticated, (req, res) => {

    const id = req.params.id;

    const { location, country, visitDate, notes } = req.body;

    const sql = `
    UPDATE itineraries
    SET location = ?,
        country = ?,
        visitDate = ?,
        notes = ?
    WHERE itineraryId = ?
    `;

    connection.query(
        sql,
        [location, country, visitDate, notes, id],
        (err, result) => {

            if (err) {
                console.log(err);
                return res.send("Database Error");
            }

            res.redirect("/itinerary");

        });

});

// Delete itinerary route
app.post('/itinerary/delete/:id', isAuthenticated, (req, res) => {

    const id = req.params.id;

    const sql = "DELETE FROM itineraries WHERE itineraryId = ?";

    connection.query(sql, [id], (err, result) => {

        if (err) {
            console.log(err);
            return res.send("Database Error");
        }

        res.redirect("/itinerary");

    });

});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running! Click here to open: http://localhost:${PORT}`);
});