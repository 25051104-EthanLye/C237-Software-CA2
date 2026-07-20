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

// middleware to make flash messages available in all views
app.use((req, res, next) => {
    res.locals.messages = req.flash();
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

// --- AUTHENTICATION MIDDLEWARE ---
const isAuthenticated = (req, res, next) => {
    if (!req.session.user) {
        req.flash('error', 'Please log in to access this page.');
        return res.redirect('/');
    }

    next();
};

// --- PATHS --- //

// Ethan's Paths
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

// End of Ethan's Paths

// 6. ITINERARY ROUTE
app.get('/trips', isAuthenticated, (req,res)=>{

    const sql=`
    SELECT
    trips.*,
    COUNT(itineraries.id) AS location_count
    FROM trips
    LEFT JOIN itineraries
    ON trips.id = itineraries.trip_id
    WHERE trips.user_id = ?
    GROUP BY trips.id
    ORDER BY trips.id DESC`;

    db.query(sql,[req.session.user.id],(err,results)=>{

        if(err){

            console.log(err);
            return res.send("Database Error");

        }

        res.render("trips",{

            trips:results

        });

    });

});

app.get('/trips/add',isAuthenticated,(req,res)=>{

    res.render("addTrip");

});

app.post('/trips/add',isAuthenticated,(req,res)=>{

    const sql=`
    INSERT INTO trips
    (user_id,trip_name)
    VALUES(?,?)
    `;

    db.query(

        sql,

        [

            req.session.user.id,

            req.body.trip_name

        ],

        (err)=>{

            if(err){

                console.log(err);

                return res.send("Database Error");

            }

            res.redirect("/trips");

        }

    );

});

app.get('/trip/:id', isAuthenticated, (req, res) => {

    const tripId = req.params.id;

    const tripSql = `
        SELECT *
        FROM trips
        WHERE id = ? AND user_id = ?
    `;

    db.query(tripSql, [tripId, req.session.user.id], (err, tripResult) => {

        if (err) {
            console.log(err);
            return res.send("Database Error");
        }

        if (tripResult.length === 0) {
            return res.send("Trip not found");
        }

        const itinerarySql = `
            SELECT *
            FROM itineraries
            WHERE trip_id = ?
            ORDER BY visit_time ASC
        `;

        db.query(itinerarySql, [tripId], (err, itineraryResult) => {

            if (err) {
                console.log(err);
                return res.send("Database Error");
            }

            res.render("itinerary", {
                trip: tripResult[0],
                itineraries: itineraryResult
            });

        });

    });

});
// Schedule
app.get('/trip/:id/schedule', isAuthenticated, (req, res) => {

    const tripId = req.params.id;

    const tripSql = `
        SELECT *
        FROM trips
        WHERE id=? AND user_id=?
    `;

    db.query(tripSql,
        [tripId, req.session.user.id],
        (err, tripResult) => {

            if (err) {
                console.log(err);
                return res.send("Database Error");
            }

            if (tripResult.length === 0) {
                return res.send("Trip not found");
            }

            const sql = `
                SELECT *
                FROM itineraries
                WHERE trip_id=?
                ORDER BY visit_time ASC
            `;

            db.query(sql,
                [tripId],
                (err, results) => {

                    if (err) {
                        console.log(err);
                        return res.send("Database Error");
                    }

                    res.render("schedule", {
                        trip: tripResult[0],
                        schedules: results
                    });

                });

        });

});
// Save itinerary route
app.post('/trip/:id/add', isAuthenticated, (req, res) => {

    const tripId = req.params.id;

    const {
        location_name,
        latitude,
        longitude,
        visit_time
    } = req.body;

    const sql = `
        INSERT INTO itineraries
        (trip_id, user_id, location_name, latitude, longitude, visit_time)
        VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.query(
        sql,
        [
            tripId,
            req.session.user.id,
            location_name,
            latitude,
            longitude,
            visit_time
        ],
        (err) => {

            if (err) {
                console.log(err);
                return res.send("Database Error");
            }

            res.redirect("/trip/" + tripId);

        }
    );

});
// Add Location Page
app.get('/trip/:id/add', isAuthenticated, (req, res) => {

    const tripId = req.params.id;

    const sql = `
        SELECT *
        FROM trips
        WHERE id = ? AND user_id = ?
    `;

    db.query(sql, [tripId, req.session.user.id], (err, results) => {

        if (err) {
            console.log(err);
            return res.send("Database Error");
        }

        if (results.length === 0) {
            return res.send("Trip not found");
        }

        res.render("addLocation", {
            trip: results[0]
        });

    });

});
// Show Edit Form
app.get('/trip/:tripId/edit/:id', isAuthenticated, (req, res) => {

    const tripId = req.params.tripId;
    const id = req.params.id;

    const sql = `
        SELECT *
        FROM itineraries
        WHERE id = ? AND trip_id = ?
    `;

    db.query(sql, [id, tripId], (err, results) => {

        if (err) {
            console.log(err);
            return res.send("Database Error");
        }

        if (results.length === 0) {
            return res.send("Location not found");
        }

        res.render("editLocation", {
            itinerary: results[0],
            tripId: tripId
        });

    });

});
// Update itinerary route
app.post('/trip/:tripId/edit/:id', isAuthenticated, (req, res) => {

    const tripId = req.params.tripId;
    const id = req.params.id;

    const {
        location_name,
        latitude,
        longitude,
        visit_time
    } = req.body;

    const sql = `
        UPDATE itineraries
        SET
            location_name=?,
            latitude=?,
            longitude=?,
            visit_time=?
        WHERE id=? AND trip_id=?
    `;

    db.query(sql,
        [
            location_name,
            latitude,
            longitude,
            visit_time,
            id,
            tripId
        ],
        (err) => {

            if (err) {
                console.log(err);
                return res.send("Database Error");
            }

            res.redirect("/trip/" + tripId);

        });

});
// Delete itinerary route
 app.post('/trip/:tripId/delete/:id', isAuthenticated, (req, res) => {

    const tripId = req.params.tripId;
    const id = req.params.id;

    const sql = `
        DELETE
        FROM itineraries
        WHERE id=? AND trip_id=?
    `;

    db.query(sql,
        [id, tripId],
        (err) => {

            if (err) {
                console.log(err);
                return res.send("Database Error");
            }

            res.redirect("/trip/" + tripId);

        });

});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running! Click here to open: http://localhost:${PORT}`);
});