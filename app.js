const express = require('express');
const mysql = require('mysql2');
const flash = require('connect-flash');

const app = express();

// Set EJS as the view engine (THIS IS THE FIX)
app.set('view engine', 'ejs');

// Database connection
const db = mysql.createConnection({
    host: 'c237-yewyih-mysql.mysql.database.azure.com',
    user: 'c237_006',
    password: 'c237006@2026!',
    database: 'c237_006_ca2_db1',
    ssl: {}
});

db.connect((err) => {
    if (err) {
        throw err;
    }
    console.log('Connected to database');
});

app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));

// PATHS GO DOWN HERE //
app.get('/', (req, res) => {
    res.render('index');
});
// END OF PATHS // 

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});