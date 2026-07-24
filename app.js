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

// --- ADMIN-ONLY MIDDLEWARE --- Arvin's part
// Blocks anyone who isn't logged in AND anyone whose role isn't 'admin'
// from reaching the inventory/review-moderation routes at the bottom of this file.
const isAdmin = (req, res, next) => {
    if (!req.session.user) {
        req.flash('error', 'Please log in to access this page.');
        return res.redirect('/');
    }
    if (req.session.user.role !== 'admin') {
        req.flash('error', 'You do not have permission to access that page.');
        return res.redirect('/');
    }
    next();
};

// --- PATHS --- //

// ------------------------------------------------------- Ethan's Path start
// 1. HOME ROUTE
app.get('/', (req, res) => {
    // Darrence: fetch a few real hotels for the Trending Hotels section
    db.query('SELECT * FROM hotels ORDER BY id DESC LIMIT 3', (err, hotels) => {
        if (err) { console.log(err); hotels = []; }
        res.render('index', {
            messages: req.flash('success'),
            errors: req.flash('error'),
            hotels: hotels
        });
    });
}); // Darrence: end of home route

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
    const { username, password, redirectUrl } = req.body;
    const targetUrl = redirectUrl || '/'; // Default to home if something goes wrong
    
    if (!username || !password) {
        req.flash('error', 'Please fill in both username and password.');
        return req.session.save(() => res.redirect(targetUrl)); 
    }
    
    const sql = 'SELECT * FROM users WHERE username = ? AND password = SHA1(?)';
    db.query(sql, [username, password], (err, results) => {
        if (err) throw err;
        
        if (results.length > 0) {
            // ARVIN: block suspended accounts from logging in
            if (results[0].account_status === 'suspended') {
                req.flash('error', 'Your account has been suspended. Please contact support.');
                return req.session.save(() => res.redirect(targetUrl));
            }

            req.session.user = results[0]; 
            req.session.save(() => res.redirect(targetUrl)); 
        } else {
            req.flash('error', 'Incorrect username or password. Please try again.');
            req.session.save(() => res.redirect(targetUrl)); 
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

// --- NEW: GLOBAL SEARCH ROUTE ---
app.get('/search', (req, res) => {
    const type = req.query.type || 'flight';
    const destination = req.query.to || ''; // What the user searched for
    
    // Query 1: Find matching flights
    let flightSql = 'SELECT * FROM flights WHERE 1=1';
    let flightParams = [];
    if (destination) {
        flightSql += ' AND destination LIKE ?';
        flightParams.push(`%${destination}%`);
    }

    // Query 2: Find matching hotels
    let hotelSql = 'SELECT * FROM hotels WHERE 1=1';
    let hotelParams = [];
    if (destination) {
        hotelSql += ' AND location LIKE ?';
        hotelParams.push(`%${destination}%`);
    }

    // Execute both queries simultaneously
    db.query(flightSql, flightParams, (err, flights) => {
        if (err) { console.log(err); return res.send("Database Error"); }
        
        db.query(hotelSql, hotelParams, (err, hotels) => {
            if (err) { console.log(err); return res.send("Database Error"); }
            
            // Send all the data to our new Search Results page!
            res.render('searchResults', {
                searchType: type,
                searchDestination: destination || 'All Destinations',
                flights: flights,
                hotels: hotels
            });
        });
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
    SELECT flight_bookings.*,
           flights.flight_number,
           flights.departure_location,
           flights.destination,
           flights.departure_date,
           flights.departure_time,
           flights.duration,
           flights.price
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
    SELECT flight_bookings.*,
           flights.flight_number,
           flights.departure_location,
           flights.destination,
           flights.departure_date,
           flights.departure_time,
           flights.duration,
           flights.price
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


// ------------------------------------------------------- Darrence's Path start
// --- MEMBER 3: HOTEL STAYS (hotel_reservations) --- //
// Mirrors Shao Feng's flight CRUD, swapped onto the hotels / hotel_reservations tables.

// H1. BROWSE HOTELS (Read) — with optional ?search= filter
app.get('/hotels', (req, res) => {
    const search = req.query.search || '';
    const sql = `SELECT * FROM hotels
                 WHERE name LIKE CONCAT('%', ?, '%') OR location LIKE CONCAT('%', ?, '%')
                 ORDER BY price_per_night ASC`;
    db.query(sql, [search, search], (err, results) => {
        if (err) { console.log(err); return res.send("Database Error"); }
        res.render('hotels', { hotels: results, search: search });
    });
});

// H2. BOOK ROOM — SHOW FORM (Create)
app.get('/hotels/book/:hotelId', isAuthenticated, (req, res) => {
    db.query('SELECT * FROM hotels WHERE id = ?', [req.params.hotelId], (err, results) => {
        if (err) { console.log(err); return res.send("Database Error"); }
        if (results.length === 0) return res.send("Hotel not found");
        res.render('bookHotel', { hotel: results[0], errors: req.flash('error') });
    });
});

// H3. BOOK ROOM — INSERT (Create)  [Enhancement 1: validation + no double-booking]
app.post('/hotels/book/:hotelId', isAuthenticated, (req, res) => {
    const hotelId = req.params.hotelId;
    const { check_in_date, checkout_date, room_type } = req.body;

    if (!check_in_date || !checkout_date || !room_type) {
        req.flash('error', 'Please fill in all fields.');
        return res.redirect('/hotels/book/' + hotelId);
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (new Date(check_in_date) < today) {
        req.flash('error', 'Check-in date cannot be in the past.');
        return res.redirect('/hotels/book/' + hotelId);
    }
    if (new Date(checkout_date) <= new Date(check_in_date)) {
        req.flash('error', 'Checkout must be after check-in.');
        return res.redirect('/hotels/book/' + hotelId);
    }

    // interval overlap: an existing booking clashes if it starts before our checkout AND ends after our check-in
    const clashSql = `SELECT COUNT(*) AS clashes FROM hotel_reservations
                      WHERE hotel_id = ? AND room_type = ?
                        AND check_in_date < ? AND checkout_date > ?`;
    db.query(clashSql, [hotelId, room_type, checkout_date, check_in_date], (err, rows) => {
        if (err) { console.log(err); return res.send("Database Error"); }
        if (rows[0].clashes > 0) {
            req.flash('error', 'Sorry, that room type is already booked for those dates.');
            return res.redirect('/hotels/book/' + hotelId);
        }
        const insertSql = `INSERT INTO hotel_reservations
                           (user_id, hotel_id, check_in_date, checkout_date, room_type)
                           VALUES (?, ?, ?, ?, ?)`;
        db.query(insertSql, [req.session.user.id, hotelId, check_in_date, checkout_date, room_type], (err2) => {
            if (err2) { console.log(err2); return res.send("Database Error"); }
            req.flash('success', 'Room booked successfully!');
            res.redirect('/reservations');
        });
    });
});

// H4. VIEW RESERVATIONS (Read) — joined with hotels for name/location/price
app.get('/reservations', isAuthenticated, (req, res) => {
    const sql = `SELECT hotel_reservations.*, hotels.name, hotels.location, hotels.price_per_night
                 FROM hotel_reservations
                 JOIN hotels ON hotel_reservations.hotel_id = hotels.id
                 WHERE hotel_reservations.user_id = ?
                 ORDER BY hotel_reservations.check_in_date ASC`;
    db.query(sql, [req.session.user.id], (err, results) => {
        if (err) { console.log(err); return res.send("Database Error"); }
        res.render('reservations', { reservations: results });
    });
});

// H5. CHANGE ROOM — SHOW FORM (Update)
app.get('/reservations/:id/room', isAuthenticated, (req, res) => {
    const sql = `SELECT hotel_reservations.*, hotels.name, hotels.location
                 FROM hotel_reservations
                 JOIN hotels ON hotel_reservations.hotel_id = hotels.id
                 WHERE hotel_reservations.id = ? AND hotel_reservations.user_id = ?`;
    db.query(sql, [req.params.id, req.session.user.id], (err, results) => {
        if (err) { console.log(err); return res.send("Database Error"); }
        if (results.length === 0) return res.send("Reservation not found");
        res.render('changeRoom', { reservation: results[0] });
    });
});

// H6. CHANGE ROOM — UPDATE (Update)
app.post('/reservations/:id/room', isAuthenticated, (req, res) => {
    const sql = `UPDATE hotel_reservations SET room_type = ? WHERE id = ? AND user_id = ?`;
    db.query(sql, [req.body.room_type, req.params.id, req.session.user.id], (err) => {
        if (err) { console.log(err); return res.send("Database Error"); }
        req.flash('success', 'Room type updated successfully!');
        res.redirect('/reservations');
    });
});

// H7. CANCEL RESERVATION (Delete)
app.post('/reservations/:id/cancel', isAuthenticated, (req, res) => {
    const sql = `DELETE FROM hotel_reservations WHERE id = ? AND user_id = ?`;
    db.query(sql, [req.params.id, req.session.user.id], (err) => {
        if (err) { console.log(err); return res.send("Database Error"); }
        req.flash('success', 'Reservation cancelled.');
        res.redirect('/reservations');
    });
});
// ------------------------------------------------------- Darrence's Path end

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

    console.log("req.body:", req.body);

    const tripId = req.params.id;
    const { location_name, latitude, longitude, visit_time } = req.body;

    const sql = `
        INSERT INTO itineraries
        (trip_id, user_id, location_name, latitude, longitude, visit_time)
        VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.query(
        sql,
        [tripId, req.session.user.id, location_name, latitude, longitude, visit_time],
        (err) => {
            if (err) {
                console.log(err);
                return res.send("Database Error");
            }

            res.redirect("/trip/" + tripId);
        }
    );
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
// ------------------------------------------------------- Alyssa's Path start

// =========================================================
// REVIEWS ROUTES
// =========================================================

// GET /reviews
// View all reviews

app.get('/reviews', (req, res) => {

    const sql = `
        SELECT 
            reviews.id,
            reviews.user_id,
            users.username AS name,
            reviews.target_destination AS destination,
            reviews.rating,
            reviews.comment AS text
        FROM reviews
        LEFT JOIN users ON reviews.user_id = users.id
        ORDER BY reviews.id DESC
    `;

    db.query(sql, (err, results) => {

        if (err) {
            console.log('Error loading reviews:', err);
            return res.send('Database Error');
        }

        res.render('reviews', {
            reviews: results,
            user: req.session.user || null
        });

    });

});

// =========================================================
// GET /reviews/add
// Show Add Review page
// =========================================================

app.get('/reviews/add', isAuthenticated, (req, res) => {

    res.render('addReview', {
        review: null,
        user: req.session.user
    });

});


// =========================================================
// POST /reviews/add
// Add a new review
// =========================================================

app.post('/reviews/add', isAuthenticated, (req, res) => {

    const { destination, rating, text } = req.body;

    // Check that all fields have been filled
    if (!destination || !rating || !text) {
        return res.send('Please fill in all fields.');
    }

    const sql = `
        INSERT INTO reviews
        (user_id, target_destination, rating, comment)
        VALUES (?, ?, ?, ?)
    `;

    const values = [
        req.session.user.id,
        destination,
        rating,
        text
    ];

    db.query(sql, values, (err, result) => {

        if (err) {

            console.log('Error adding review:', err);

            return res.send(
                'Database Error: ' + err.message
            );

        }

        console.log('Review added successfully!');

        res.redirect('/reviews');

    });

});

// =========================================================
// GET /reviews/edit/:id
// Show Edit Review page
// =========================================================

// =========================================================
// GET /reviews/edit/:id
// Display the Edit Review page
// =========================================================

app.get('/reviews/edit/:id', isAuthenticated, (req, res) => {

    const reviewId = req.params.id;

    const sql = `
        SELECT
            id,
            user_id,
            target_destination AS destination,
            rating,
            comment AS text
        FROM reviews
        WHERE id = ? AND user_id = ?
    `;

    db.query(
        sql,
        [
            reviewId,
            req.session.user.id
        ],
        (err, results) => {

            if (err) {

                console.log(
                    'Error loading review for editing:',
                    err
                );

                return res.send(
                    'Database Error: ' + err.message
                );

            }


            // Check if review exists
            // and belongs to logged-in user

            if (results.length === 0) {

                return res.send(
                    'Review not found or you do not have permission to edit this review.'
                );

            }


            // Display editReviews.ejs

            res.render('editReviews', {

                review: results[0],

                user: req.session.user

            });

        }

    );

});

// =========================================================
// POST /reviews/edit/:id
// Update an existing review
// =========================================================

// =========================================================
// POST /reviews/edit/:id
// Update the review in the database
// =========================================================

app.post('/reviews/edit/:id', isAuthenticated, (req, res) => {

    const reviewId = req.params.id;

    const {
        destination,
        rating,
        text
    } = req.body;


    // =====================================================
    // VALIDATION
    // =====================================================

    if (!destination || !rating || !text) {

        return res.send(
            'Please fill in all fields.'
        );

    }


    // =====================================================
    // UPDATE REVIEW
    // Only update the review if it belongs
    // to the logged-in user
    // =====================================================

    const sql = `
        UPDATE reviews

        SET
            target_destination = ?,
            rating = ?,
            comment = ?

        WHERE
            id = ?
            AND user_id = ?
    `;


    const values = [

        destination,

        rating,

        text,

        reviewId,

        req.session.user.id

    ];


    db.query(
        sql,
        values,
        (err, result) => {

            if (err) {

                console.log(
                    'Error updating review:',
                    err
                );

                return res.send(
                    'Database Error: ' + err.message
                );

            }


            // =================================================
            // CHECK IF REVIEW WAS UPDATED
            // =================================================

            if (result.affectedRows === 0) {

                return res.send(

                    'Review not found or you do not have permission to edit this review.'

                );

            }


            console.log(
                'Review updated successfully!'
            );


            // =================================================
            // REDIRECT TO REVIEWS PAGE
            // =================================================

            res.redirect('/reviews');

        }

    );

});


// =========================================================
// POST /reviews/delete/:id
// Delete a review
// =========================================================

app.post('/reviews/delete/:id', isAuthenticated, (req, res) => {

    const reviewId = req.params.id;

    const sql = `
        DELETE FROM reviews
        WHERE id = ? AND user_id = ?
    `;

    db.query(
        sql,
        [reviewId, req.session.user.id],
        (err, result) => {

            if (err) {
                console.log('Error deleting review:', err);
                return res.send('Database Error');
            }

            res.redirect('/reviews');

        }
    );
});



// ------------------------------------------------------- Alyssa's Path end

// ------------------------------------------------------- Arvin's Path start
// Admin Control: Inventory Management & Review Moderation
// Covers: Add Inventory, View All, Resolve Issues (-> review moderation), Delete Items
// All routes below require an admin-role account (see isAdmin middleware)
// ==================================================================

// ADMIN DASHBOARD (hub linking to hotels / flights / reviews)
app.get('/admin', isAdmin, (req, res) => {
    res.render('admin/ADMINdashboard', { user: req.session.user });
});

// ----- HOTEL INVENTORY -----

// VIEW ALL: list every hotel currently in the system
app.get('/admin/hotels', isAdmin, (req, res) => {
    const sql = 'SELECT * FROM hotels ORDER BY id DESC';

    db.query(sql, (err, results) => {
        if (err) { console.log(err); return res.send("Database Error"); }

        res.render('admin/ADMINhotels', {
            user: req.session.user,
            hotels: results,
            messages: req.flash('success'),
            errors: req.flash('error')
        });
    });
});

// ADD INVENTORY: insert a new hotel
app.post('/admin/hotels/add', isAdmin, upload.single('image'), (req, res) => {
    const { name, location, price_per_night } = req.body;

    if (!name || !location || !price_per_night) {
        req.flash('error', 'All fields are required to add a hotel.');
        return res.redirect('/admin/hotels');
    }

    let imageUri = null;
    if (req.file) {
        imageUri = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    }

    const sql = 'INSERT INTO hotels (name, location, price_per_night, image) VALUES (?, ?, ?, ?)';

 db.query(sql, [name, location, price_per_night, imageUri], (err) => {
        if (err) { console.log(err); return res.send("Database Error"); }

        req.flash('success', `Hotel "${name}" added to inventory.`);
        res.redirect('/admin/hotels');
    });
});

// DELETE ITEMS: remove a hotel
app.post('/admin/hotels/delete/:id', isAdmin, (req, res) => {
    const sql = 'DELETE FROM hotels WHERE id = ?';

    db.query(sql, [req.params.id], (err) => {
        if (err) { console.log(err); return res.send("Database Error"); }

        req.flash('success', 'Hotel removed from inventory.');
        res.redirect('/admin/hotels');
    });
});

app.get('/admin/flights/edit/:id', isAdmin, (req, res) => {
    const sql = 'SELECT * FROM flights WHERE id = ?';

    db.query(sql, [req.params.id], (err, results) => {
        if (err) { console.log(err); return res.send("Database Error"); }
        if (results.length === 0) { return res.send("Flight not found"); }

        res.render('admin/ADMINeditFlight', { flight: results[0] });
    });
});

app.post('/admin/flights/edit/:id', isAdmin, (req, res) => {
    const { flight_number, destination, departure_date, departure_time, duration, price } = req.body;

    const sql = `
        UPDATE flights
        SET flight_number = ?, destination = ?, departure_date = ?, departure_time = ?, duration = ?, price = ?
        WHERE id = ?
    `;

    db.query(sql, [flight_number, destination, departure_date, departure_time, duration, price, req.params.id], (err) => {
        if (err) { console.log(err); return res.send("Database Error"); }

        req.flash('success', `Flight ${flight_number} updated.`);
        res.redirect('/admin/flights');
    });
});

// Arvin - EDIT (Show Form): pre-fill the edit page with this hotel's current data
app.get('/admin/hotels/edit/:id', isAdmin, (req, res) => {
    const sql = 'SELECT * FROM hotels WHERE id = ?';

    db.query(sql, [req.params.id], (err, results) => {
        if (err) { console.log(err); return res.send("Database Error"); }
        if (results.length === 0) { return res.send("Hotel not found"); }

        res.render('admin/ADMINeditHotel', { hotel: results[0] });
    });
});

// EDIT (Save): update the hotel with the submitted changes
app.post('/admin/hotels/edit/:id', isAdmin, (req, res) => {
    const { name, location, price_per_night } = req.body;

    const sql = 'UPDATE hotels SET name = ?, location = ?, price_per_night = ? WHERE id = ?';

    db.query(sql, [name, location, price_per_night, req.params.id], (err) => {
        if (err) { console.log(err); return res.send("Database Error"); }

        req.flash('success', `Hotel "${name}" updated.`);
        res.redirect('/admin/hotels');
    });
});

// ----- FLIGHT INVENTORY -----

// VIEW ALL: list every flight route currently in the system
app.get('/admin/flights', isAdmin, (req, res) => {
    const sql = 'SELECT * FROM flights ORDER BY id DESC';

    db.query(sql, (err, results) => {
        if (err) { console.log(err); return res.send("Database Error"); }

        res.render('admin/ADMINflights', {
            user: req.session.user,
            flights: results,
            messages: req.flash('success'),
            errors: req.flash('error')
        });
    });
});

// ADD INVENTORY: insert a new flight route
app.post('/admin/flights/add', isAdmin, (req, res) => {
    const { flight_number, destination, departure_date, departure_time, duration, price } = req.body;

    if (!flight_number || !destination || !departure_date || !departure_time || !duration || !price) {
        req.flash('error', 'All fields are required to add a flight.');
        return res.redirect('/admin/flights');
    }

    const sql = `
        INSERT INTO flights (flight_number, destination, departure_date, departure_time, duration, price)
        VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, [flight_number, destination, departure_date, departure_time, duration, price], (err) => {
        if (err) { console.log(err); return res.send("Database Error"); }

        req.flash('success', `Flight ${flight_number} added to inventory.`);
        res.redirect('/admin/flights');
    });
});

// DELETE ITEMS: remove a flight route
app.post('/admin/flights/delete/:id', isAdmin, (req, res) => {
    const sql = 'DELETE FROM flights WHERE id = ?';

    db.query(sql, [req.params.id], (err) => {
        if (err) { console.log(err); return res.send("Database Error"); }

        req.flash('success', 'Flight removed from inventory.');
        res.redirect('/admin/flights');
    });
});

// ----- REVIEW MODERATION ("Resolve Issues") -----
// NOTE: the feedback table was cancelled by the team, so this covers
// "Resolve Issues" by letting admin view all reviews and remove bad/inappropriate ones.

// VIEW ALL: list every review submitted by users, newest first
app.get('/admin/reviews', isAdmin, (req, res) => {
    const sql = `
        SELECT reviews.*, users.username
        FROM reviews
        LEFT JOIN users ON reviews.user_id = users.id
        ORDER BY reviews.id DESC
    `;

    db.query(sql, (err, results) => {
        if (err) { console.log(err); return res.send("Database Error"); }

        res.render('admin/ADMINreviews', {
            user: req.session.user,
            reviews: results,
            messages: req.flash('success'),
            errors: req.flash('error')
        });
    });
});

// DELETE ITEMS: remove an inappropriate/bad review
app.post('/admin/reviews/delete/:id', isAdmin, (req, res) => {
    const sql = 'DELETE FROM reviews WHERE id = ?';

    db.query(sql, [req.params.id], (err) => {
        if (err) { console.log(err); return res.send("Database Error"); }

        req.flash('success', 'Review removed.');
        res.redirect('/admin/reviews');
    });
});

// ----- USER MANAGEMENT (Ban/Unban) -----

// VIEW ALL: list every registered user
app.get('/admin/users', isAdmin, (req, res) => {
    const sql = 'SELECT * FROM users ORDER BY id DESC';

    db.query(sql, (err, results) => {
        if (err) { console.log(err); return res.send("Database Error"); }

        res.render('admin/ADMINban', {
            user: req.session.user,
            users: results,
            messages: req.flash('success'),
            errors: req.flash('error')
        });
    });
});

// BAN: block a user from logging in
app.post('/admin/users/ban/:id', isAdmin, (req, res) => {
    const sql = "UPDATE users SET account_status = 'suspended' WHERE id = ?";

    db.query(sql, [req.params.id], (err) => {
        if (err) { console.log(err); return res.send("Database Error"); }

        req.flash('success', 'User has been banned.');
        res.redirect('/admin/users');
    });
});

// UNBAN: restore a user's access
app.post('/admin/users/unban/:id', isAdmin, (req, res) => {
    const sql = "UPDATE users SET account_status = 'active' WHERE id = ?";

    db.query(sql, [req.params.id], (err) => {
        if (err) { console.log(err); return res.send("Database Error"); }

        req.flash('success', 'User has been unbanned.');
        res.redirect('/admin/users');
    });
});

// ------------------------------------------------------- Arvin's Path end

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running! Click here to open: http://localhost:${PORT}`);
});
