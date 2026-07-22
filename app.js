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

//--------------------------------------------------------Shao Feng's Path start
// --- MEMBER 2: FLIGHT BOOKINGS PATHS --- //

// 7. BROWSE / SEARCH FLIGHTS
app.get('/flights', (req, res) => {

    // Build a parameterized query based on provided search filters
    const where = [];
    const params = [];

    if (req.query.destination) {
        where.push('destination LIKE ?');
        params.push('%' + req.query.destination + '%');
    }

    if (req.query.origin) {
        where.push('origin LIKE ?');
        params.push('%' + req.query.origin + '%');
    }

    if (req.query.date) {
        // Accept either YYYY-MM-DD or DD/MM/YYYY from various clients
        let qdate = req.query.date;
        if (qdate.indexOf('/') !== -1) {
            const parts = qdate.split('/'); // dd/mm/yyyy
            if (parts.length === 3) {
                const [dd, mm, yyyy] = parts;
                qdate = `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
            }
        }
        // push normalized date
        where.push('departure_date = ?');
        params.push(qdate);
        console.log('Flights filter date:', qdate);
    }

    if (req.query.direct) {
        // assume direct is sent as '1' or '0' or 'true'/'false'
        const val = (req.query.direct === '1' || req.query.direct === 'true') ? 1 : 0;
        where.push('direct = ?');
        params.push(val);
    }

    let sql = 'SELECT * FROM flights';
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY departure_date ASC, departure_time ASC';

    db.query(sql, params, (err, results) => {

        if (err) {
            console.log(err);
            return res.send("Database Error");
        }

        res.render('flights', {
            user: req.session.user,
            flights: results,
            filters: req.query || {}
        });

    });

});

// 7b. HOMEPAGE SEARCH WIDGET -> redirects into /flights with a destination filter
app.get('/search', (req, res) => {
    const params = new URLSearchParams();
    ['destination','date','adults','children','travel_class','origin','return_date','direct']
        .forEach(key => { if (req.query[key]) params.set(key, req.query[key]); });
    const qs = params.toString();
    res.redirect('/flights' + (qs ? ('?' + qs) : ''));
});

// 7c. CITY AUTOCOMPLETE - returns destinations from the flights table matching what's typed
app.get('/flights/search-cities', (req, res) => {

    const q = req.query.q || '';

    const sql = `
        SELECT DISTINCT destination
        FROM flights
        WHERE destination LIKE CONCAT(?, '%')
        ORDER BY destination ASC
        LIMIT 10
    `;

    db.query(sql, [q], (err, results) => {

        if (err) {
            console.log(err);
            return res.json([]);
        }

        res.json(results.map(row => row.destination));

    });

});

// 8. BOOK FLIGHT - SHOW FORM (Create)
app.get('/flights/book/:flightId', isAuthenticated, (req, res) => {

    const flightId = req.params.flightId;

    const sql = `SELECT * FROM flights WHERE id = ?`;

    db.query(sql, [flightId], (err, results) => {

        if (err) {
            console.log(err);
            return res.send("Database Error");
        }

        if (results.length === 0) {
            return res.send("Flight not found");
        }

        res.render('bookFlights', {
            flight: results[0]
        });

    });

});

// 9. BOOK FLIGHT - INSERT (Create)
app.post('/flights/book/:flightId', isAuthenticated, (req, res) => {

    const flightId = req.params.flightId;
    const { seat_preference } = req.body;

    if (!seat_preference) {
        req.flash('error', 'Please select a seat preference.');
        return res.redirect('/flights/book/' + flightId);
    }

    const sql = `
        INSERT INTO flight_bookings (user_id, flight_id, seat_preference)
        VALUES (?, ?, ?)
    `;

    db.query(sql, [req.session.user.id, flightId, seat_preference], (err) => {

        if (err) {
            console.log(err);
            return res.send("Database Error");
        }

        req.flash('success', 'Flight booked successfully!');
        res.redirect('/bookings');

    });

});

// 10. VIEW BOOKINGS (Read) - joined with flights for details
app.get('/bookings', isAuthenticated, (req, res) => {

    const sql = `
        SELECT flight_bookings.*, flights.flight_number, flights.destination,
               flights.departure_date, flights.departure_time, flights.arrival_time, flights.duration, flights.price
        FROM flight_bookings
        JOIN flights ON flight_bookings.flight_id = flights.id
        WHERE flight_bookings.user_id = ?
        ORDER BY flights.departure_date ASC, flights.departure_time ASC
    `;

    db.query(sql, [req.session.user.id], (err, results) => {

        if (err) {
            console.log(err);
            return res.send("Database Error");
        }

        res.render('bookings', {
            bookings: results
        });

    });

});

// 11. CHANGE SEAT - SHOW FORM (Update)
app.get('/bookings/:id/seat', isAuthenticated, (req, res) => {

    const id = req.params.id;

    const sql = `
        SELECT flight_bookings.*, flights.flight_number, flights.destination,
               flights.departure_date, flights.departure_time, flights.arrival_time
        FROM flight_bookings
        JOIN flights ON flight_bookings.flight_id = flights.id
        WHERE flight_bookings.id = ? AND flight_bookings.user_id = ?
    `;

    db.query(sql, [id, req.session.user.id], (err, results) => {

        if (err) {
            console.log(err);
            return res.send("Database Error");
        }

        if (results.length === 0) {
            return res.send("Booking not found");
        }

        res.render('changeSeat', {
            booking: results[0]
        });

    });

});

// 12. CHANGE SEAT - UPDATE (Update)
app.post('/bookings/:id/seat', isAuthenticated, (req, res) => {

    const id = req.params.id;
    const { seat_preference } = req.body;

    const sql = `
        UPDATE flight_bookings
        SET seat_preference = ?
        WHERE id = ? AND user_id = ?
    `;

    db.query(sql, [seat_preference, id, req.session.user.id], (err) => {

        if (err) {
            console.log(err);
            return res.send("Database Error");
        }

        req.flash('success', 'Seat preference updated successfully!');
        res.redirect('/bookings');

    });

});

// 13. CANCEL BOOKING (Delete)
app.post('/bookings/:id/cancel', isAuthenticated, (req, res) => {

    const id = req.params.id;

    const sql = `DELETE FROM flight_bookings WHERE id = ? AND user_id = ?`;

    db.query(sql, [id, req.session.user.id], (err) => {

        if (err) {
            console.log(err);
            return res.send("Database Error");
        }

        req.flash('success', 'Booking cancelled.');
        res.redirect('/bookings');

    });

});


//--------------------------------------------------------Shao Feng's Path end

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

// --- REVIEWS ROUTES ---
app.get('/reviews', (req, res) => {
    const sql = 'SELECT * FROM reviews ORDER BY date DESC';
    db.query(sql, (err, results) => {
        if (err) {
            console.log(err);
            return res.send("Database Error");
        }
        res.render('reviews', { reviews: results });
    });
});

app.post('/reviews/add', isAuthenticated, (req, res) => {
    const { name, destination, rating, text } = req.body;
    const sql = 'INSERT INTO reviews (user_id, name, destination, rating, text) VALUES (?, ?, ?, ?, ?)';
    db.query(sql, [req.session.user.id, name, destination, rating, text], (err) => {
        if (err) {
            console.log(err);
            return res.send("Database Error");
        }
        res.redirect('/reviews');
    });
});

app.post('/reviews/delete/:id', isAuthenticated, (req, res) => {
    const sql = 'DELETE FROM reviews WHERE id = ? AND user_id = ?';
    db.query(sql, [req.params.id, req.session.user.id], (err) => {
        if (err) {
            console.log(err);
            return res.send("Database Error");
        }
        res.redirect('/reviews');
    });
});

app.post('/reviews/edit/:id', isAuthenticated, (req, res) => {
    const { name, destination, rating, text } = req.body;
    const sql = 'UPDATE reviews SET name = ?, destination = ?, rating = ?, text = ? WHERE id = ? AND user_id = ?';
    db.query(sql, [name, destination, rating, text, req.params.id, req.session.user.id], (err) => {
        if (err) {
            console.log(err);
            return res.send("Database Error");
        }
        res.redirect('/reviews');
    });
});

// ------------------------------------------------------- Rui Qi's Path end

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running! Click here to open: http://localhost:${PORT}`);
});