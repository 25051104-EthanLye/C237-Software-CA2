const express = require('express');
const mysql = require('mysql2');
const flash = require('connect-flash');
const session = require('express-session');
// Edit profile pic
const multer = require('multer');
const path = require('path');

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
    saveUninitialized: false,
    // NEW: Save the cookie for 30 days so the user stays logged in after closing the browser
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days in milliseconds
    }
}));

app.use(flash());

// --- NEW: Configure Multer to use Memory Storage (RAM) instead of folders ---
// This allows us to intercept the file buffer and convert it for the database
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- GLOBAL VARIABLES MIDDLEWARE ---
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

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

// --- AUTHENTICATION MIDDLEWARE --- Ethan's part
const isAuthenticated = (req, res, next) => {
    if (!req.session.user) {
        req.flash('error', 'Please log in to access this page.');
        return res.redirect('/');
    }
    next();
};

// --- PATHS --- //

// ------------------------------------------------------- Ethan's Path start
// 1. HOME ROUTE
app.get('/', (req, res) => {
    res.render('index', { 
        messages: req.flash('success'),
        errors: req.flash('error') 
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
            if (results[0].username === username) errorMsg = 'That username is already taken.';
            else if (results[0].email === email) errorMsg = 'That email is already registered.';

            req.flash('error', errorMsg);
            return res.render('register', { 
                messages: req.flash('error'), 
                formData: { username: '', email: '', contact } 
            });
        }

        const insertSql = 'INSERT INTO users (username, email, contact, password, role, account_status) VALUES (?, ?, ?, SHA1(?), ?, ?)';
        
        db.query(insertSql, [username, email, contact, password, 'user', 'active'], (err, result) => {
            if (err) throw err;
            req.flash('success', 'Registration successful! Please log in.');
            res.redirect('/'); 
        });
    });
});

// 4. LOGIN POST ROUTE
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        req.flash('error', 'Please fill in both username and password.');
        return req.session.save(() => res.redirect('/')); 
    }
    
    const sql = 'SELECT * FROM users WHERE username = ? AND password = SHA1(?)';
    db.query(sql, [username, password], (err, results) => {
        if (err) throw err;
        
        if (results.length > 0) {
            req.session.user = results[0]; 
            req.session.save(() => res.redirect('/')); 
        } else {
            req.flash('error', 'Incorrect username or password. Please try again.');
            req.session.save(() => res.redirect('/')); 
        }
    });
});

// 5. LOGOUT ROUTE
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 7. PROFILE ROUTES --- //

// Render the Profile Page
app.get('/profile', isAuthenticated, (req, res) => {
    const sql = 'SELECT * FROM users WHERE id = ?';
    db.query(sql, [req.session.user.id], (err, results) => {
        if (err) { console.log(err); return res.send("Database Error"); }
        
        res.render('profile', { 
            userData: results[0],
            messages: req.flash() 
        });
    });
});

// Process the Profile Edits
app.post('/profile/edit', isAuthenticated, (req, res) => {
    const { username, email, contact, password } = req.body;
    
    let sql;
    let params;

    if (password && password.trim() !== "") {
        sql = 'UPDATE users SET username = ?, email = ?, contact = ?, password = SHA1(?) WHERE id = ?';
        params = [username, email, contact, password, req.session.user.id];
    } else {
        sql = 'UPDATE users SET username = ?, email = ?, contact = ? WHERE id = ?';
        params = [username, email, contact, req.session.user.id];
    }

    db.query(sql, params, (err, results) => {
        if (err) { 
            console.log(err); 
            req.flash('error', 'Update failed. That username or email might already be taken.');
            return res.redirect('/profile'); 
        }
        
        req.session.user.username = username;
        req.session.user.email = email;
        req.session.user.contact = contact;
        
        req.flash('success', 'Profile updated successfully!');
        res.redirect('/profile');
    });
});

// --- UPDATED ROUTE: Upload Profile Picture to Database ---
app.post('/profile/upload-picture', isAuthenticated, upload.single('profile_picture'), (req, res) => {
    if (!req.file) {
        req.flash('error', 'Please select an image to upload.');
        return res.redirect('/profile');
    }

    // 1. Convert the binary image buffer into a Base64 string
    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;
    
    // 2. Create the full Data URI string (this is what the browser reads)
    const imageUri = `data:${mimeType};base64,${base64Image}`;

    // 3. Save the giant text string directly into the database
    const sql = 'UPDATE users SET profile_picture = ? WHERE id = ?';
    
    db.query(sql, [imageUri, req.session.user.id], (err, results) => {
        if (err) { console.log(err); return res.send("Database Error - Ensure column is LONGTEXT"); }
        
        // 4. Update session
        req.session.user.profile_picture = imageUri; 
        req.flash('success', 'Profile picture updated successfully!');
        res.redirect('/profile');
    });
});

// --- ROUTE: Delete Profile Picture ---
app.post('/profile/delete-picture', isAuthenticated, (req, res) => {
    const sql = 'UPDATE users SET profile_picture = NULL WHERE id = ?';
    
    db.query(sql, [req.session.user.id], (err, results) => {
        if (err) { console.log(err); return res.send("Database Error"); }
        
        req.session.user.profile_picture = null; 
        req.flash('success', 'Profile picture removed.');
        res.redirect('/profile');
    });
});
// ------------------------------------------------------- Ethan's Path end
// ------------------------------------------------------- Rui Qi's Path start
// 6. ITINERARY ROUTES
app.get('/trips', isAuthenticated, (req,res)=>{
    const sql=`
    SELECT trips.*, COUNT(itineraries.id) AS location_count
    FROM trips LEFT JOIN itineraries ON trips.id = itineraries.trip_id
    WHERE trips.user_id = ? GROUP BY trips.id ORDER BY trips.id DESC`;

    db.query(sql,[req.session.user.id],(err,results)=>{
        if(err){ console.log(err); return res.send("Database Error"); }
        res.render("trips",{ trips:results });
    });
});

app.get('/trips/add',isAuthenticated,(req,res)=>{
    res.render("addTrip");
});

app.post('/trips/add',isAuthenticated,(req,res)=>{
    const sql=`INSERT INTO trips (user_id,trip_name) VALUES(?,?)`;
    db.query(sql, [req.session.user.id, req.body.trip_name], (err)=>{
        if(err){ console.log(err); return res.send("Database Error"); }
        res.redirect("/trips");
    });
});

app.get('/trip/:id', isAuthenticated, (req, res) => {
    const tripId = req.params.id;
    const tripSql = `SELECT * FROM trips WHERE id = ? AND user_id = ?`;

    db.query(tripSql, [tripId, req.session.user.id], (err, tripResult) => {
        if (err) { console.log(err); return res.send("Database Error"); }
        if (tripResult.length === 0) return res.send("Trip not found");

        const itinerarySql = `SELECT * FROM itineraries WHERE trip_id = ? ORDER BY visit_time ASC`;
        db.query(itinerarySql, [tripId], (err, itineraryResult) => {
            if (err) { console.log(err); return res.send("Database Error"); }
            res.render("itinerary", { trip: tripResult[0], itineraries: itineraryResult });
        });
    });
});

app.get('/trip/:id/schedule', isAuthenticated, (req, res) => {
    const tripId = req.params.id;
    const tripSql = `SELECT * FROM trips WHERE id=? AND user_id=?`;

    db.query(tripSql, [tripId, req.session.user.id], (err, tripResult) => {
        if (err) { console.log(err); return res.send("Database Error"); }
        if (tripResult.length === 0) return res.send("Trip not found");

        const sql = `SELECT * FROM itineraries WHERE trip_id=? ORDER BY visit_time ASC`;
        db.query(sql, [tripId], (err, results) => {
            if (err) { console.log(err); return res.send("Database Error"); }
            res.render("schedule", { trip: tripResult[0], schedules: results });
        });
    });
});

app.post('/trip/:id/add', isAuthenticated, (req, res) => {
    const tripId = req.params.id;
    const { location_name, latitude, longitude, visit_time } = req.body;
    const sql = `INSERT INTO itineraries (trip_id, user_id, location_name, latitude, longitude, visit_time) VALUES (?, ?, ?, ?, ?, ?)`;

    db.query(sql, [tripId, req.session.user.id, location_name, latitude, longitude, visit_time], (err) => {
        if (err) { console.log(err); return res.send("Database Error"); }
        res.redirect("/trip/" + tripId);
    });
});

app.get('/trip/:id/add', isAuthenticated, (req, res) => {
    const tripId = req.params.id;
    const sql = `SELECT * FROM trips WHERE id = ? AND user_id = ?`;

    db.query(sql, [tripId, req.session.user.id], (err, results) => {
        if (err) { console.log(err); return res.send("Database Error"); }
        if (results.length === 0) return res.send("Trip not found");
        res.render("addLocation", { trip: results[0] });
    });
});

app.get('/trip/:tripId/edit/:id', isAuthenticated, (req, res) => {
    const tripId = req.params.tripId;
    const id = req.params.id;
    const sql = `SELECT * FROM itineraries WHERE id = ? AND trip_id = ?`;

    db.query(sql, [id, tripId], (err, results) => {
        if (err) { console.log(err); return res.send("Database Error"); }
        if (results.length === 0) return res.send("Location not found");
        res.render("editLocation", { itinerary: results[0], tripId: tripId });
    });
});

app.post('/trip/:tripId/edit/:id', isAuthenticated, (req, res) => {
    const tripId = req.params.tripId;
    const id = req.params.id;
    const { location_name, latitude, longitude, visit_time } = req.body;

    const sql = `UPDATE itineraries SET location_name=?, latitude=?, longitude=?, visit_time=? WHERE id=? AND trip_id=?`;

    db.query(sql, [location_name, latitude, longitude, visit_time, id, tripId], (err) => {
        if (err) { console.log(err); return res.send("Database Error"); }
        res.redirect("/trip/" + tripId);
    });
});

app.post('/trip/:tripId/delete/:id', isAuthenticated, (req, res) => {
    const tripId = req.params.tripId;
    const id = req.params.id;
    const sql = `DELETE FROM itineraries WHERE id=? AND trip_id=?`;

    db.query(sql, [id, tripId], (err) => {
        if (err) { console.log(err); return res.send("Database Error"); }
        res.redirect("/trip/" + tripId);
    });
});

app.post('/trip/delete/:id', isAuthenticated, (req,res)=>{

    const id = req.params.id;

    const sql = `
        DELETE FROM trips
        WHERE id=?
    `;

    db.query(sql,[id],(err)=>{

        if(err){
            console.log(err);
            return res.send("Database Error");
        }

        res.redirect("/trips");

    });

});

// ------------------------------------------------------- Rui Qi's Path end

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running! Click here to open: http://localhost:${PORT}`);
});