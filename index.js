// Import required modules
import express from "express";
import bodyParser from "body-parser";
import session from "express-session";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { createPool } from "mysql";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = 3000;

// Create a MySQL connection pool
const pool = createPool({
  host: "localhost",
  user: "root",
  password: "",
  database: "dbproject",
  connectionLimit: 10,
});

// Set up middleware
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));

// Set up session middleware
app.use(session({
  secret: 'Saad', // Change this to a secret key
  resave: false,
  saveUninitialized: true
}));

// Define routes
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/Home.html");
});

// Fetch all products from the database
app.get("/products", (req, res) => {
  const fetchProductsQuery = "SELECT * FROM products";

  pool.query(fetchProductsQuery, (err, products, fields) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error fetching product data");
    }

    // Render the Products.ejs file with the fetched product data
    res.render('Products.ejs', { products });
  });
});

// Add this route to your existing Express app
app.post("/addToCart", (req, res) => {
  // Extract product details from the request body
  const { Pid, name, description, price, image_path, quantity } = req.body;

  // Check if the requested quantity is available in the database
  const checkQuantityQuery = "SELECT quantity FROM products WHERE Pid = ?";
  pool.query(checkQuantityQuery, [Pid], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error checking product quantity");
    }

    const availableQuantity = results[0].quantity;

    if (quantity > availableQuantity) {
      return res.status(400).send("Not enough quantity available");
    }

    // Deduct the purchased quantity from the available quantity in the database
    const updatedQuantity = availableQuantity - quantity;
    const updateQuantityQuery = "UPDATE products SET quantity = ? WHERE Pid = ?";
    
    pool.query(updateQuantityQuery, [updatedQuantity, Pid], (err) => {
      if (err) {
        console.error(err);
        return res.status(500).send("Error updating product quantity");
      }

      // Add the product to the session-based cart
      req.session.cart = req.session.cart || [];

      // Check if the product is already in the cart
      const existingProductIndex = req.session.cart.findIndex((item) => item.pid === Pid);

      if (existingProductIndex !== -1) {
        // Product already exists in the cart, update the quantity
        req.session.cart[existingProductIndex].quantity += parseInt(quantity, 10);
      } else {
        // Product doesn't exist in the cart, add a new entry
        req.session.cart.push({
          pid: Pid,
          name,
          description,
          price,
          image_path,
          quantity: parseInt(quantity, 10),
        });
      }

      // Redirect to the Products page or any other page
      res.redirect("/products");
    });
  });
});

// Remove from cart route
app.post('/removeFromCart/:productId', (req, res) => {
  const productId = req.params.productId;
  console.log("Received request to remove item with productId:", productId);

  // Check if req.session.cart is defined
  if (req.session.cart && Array.isArray(req.session.cart)) {
    // Log the session before cart modification
    console.log("Session before cart modification:", req.session);

    // Find and remove the item from the cart
    req.session.cart = req.session.cart.filter((item) => item.pid !== productId);

    // Log the session after cart modification
    console.log("Session after cart modification:", req.session);

    // Update the session
    req.session.save((err) => {
      if (err) {
        console.error("Error updating session:", err);
        return res.status(500).json({ success: false, error: 'Error updating session' });
      }

      // Redirect to the cart page or any other page
      res.redirect("/cart");
    });
  } else {
    // If req.session.cart is undefined or not an array, respond with an error
    res.status(500).json({ success: false, error: 'Session cart not properly initialized' });
  }
});


// Cart route
app.get("/cart", (req, res) => {
  res.render('cart.ejs', { cart: req.session.cart || [], session: req.session });
});

// Add these routes for updating the quantity
app.post("/updateQuantity/:action/:pid", (req, res) => {
  const productId = req.params.pid;
  const action = req.params.action;

  const product = req.session.cart.find(item => item.pid === productId);
  if (product) {
    if (action === "increase") {
      product.quantity += 1;
    } else if (action === "decrease" && product.quantity > 1) {
      product.quantity -= 1;
    }
  }

  // Send the updated cart back
  res.json({ success: true, cart: req.session.cart });
});

// Add a new route for checkout
app.get("/checkout", (req, res) => {
  // Extract total price from the query parameter
  const totalPrice = req.query.totalPrice || 0;

  // Assuming you have a checkout.ejs template
  res.render("checkout.ejs", { cart: req.session.cart || [], totalPrice });
});

// Handle the checkout form submission
app.post("/checkout", async (req, res) => {
  console.log(req.session.userData.Cid);
  try {
    // Check if req.session.cart exists and is an array
    if (!req.session.cart || !Array.isArray(req.session.cart)) {
      return res.status(400).send("Cart is not properly initialized");
    }

    // Extract necessary data from the request body
    const { name, phone, email, address, payment } = req.body;

    // Check if req.session.cart is not empty
    if (req.session.cart.length === 0) {
      return res.status(400).send("Cart is empty");
    }

    // Calculate the total price based on the items in the cart
    const totalPrice = req.session.cart.reduce(
      (total, item) => total + item.price * item.quantity,
      0
    );

    // Assuming you have a 'orders' table in your database
    const insertOrderQuery = `
      INSERT INTO orders (C_id, P_id, name, phone, email, address, quantity, total_price, payment)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    // Insert order details into the 'orders' table for each item in the cart
    for (const item of req.session.cart) {
      await pool.query(insertOrderQuery, [
        req.session.userData.Cid, // Assuming you have user data in the session
        item.pid,
        name,
        phone,
        email, 
        address, 
        item.quantity,
        item.price * item.quantity,
        payment,
      ]);
    }

    // Clear the user's cart
    req.session.cart = [];

    // Redirect to the thank you page or any other confirmation page
    res.redirect("/thank-you");
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/thank-you", (req, res) => {
    res.sendFile(__dirname + "/public/thankYou.html")
});

app.get("/customerView", (req, res) => {
  const fetchServicesQuery = `
      SELECT customers_services.S_id, customers_services.reviewed, services.services, customers_services.Day, mechanics.fullName AS mechanicName, customers_services.M_id AS M_id, customers_services.received
      FROM customers_services
      INNER JOIN services ON customers_services.S_id = services.Sid
      INNER JOIN mechanics ON customers_services.M_id = mechanics.Mid
      WHERE customers_services.C_id = ?;
    `;
// Fetch customer orders
const fetchOrdersQuery = `
      SELECT orders.*, products.name
      FROM orders
      INNER JOIN products ON orders.P_id = products.Pid
      WHERE C_id = ?;
    `;

  pool.query(fetchServicesQuery, [req.session.userData.Cid], (err, servicesData, fields) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error fetching customer services data");
    }

    // Fetch customer orders
    pool.query(fetchOrdersQuery, [req.session.userData.Cid], (err, ordersData, fields) => {
      if (err) {
        console.error(err);
        return res.status(500).send("Error fetching customer orders data");
      }

      // Render the view with user data, services data, and orders data
      res.render('customerView.ejs', { userData: req.session.userData, servicesData, ordersData });
    });
  });

  // Fetch customer orders
  // pool.query(fetchOrdersQuery, [req.session.userData.Cid], (err, ordersData, fields) => {
  //   if (err) {
  //     console.error(err);
  //     return res.status(500).send("Error fetching customer orders data");
  //   }

  //   // Fetch customer services
  //   pool.query(fetchServicesQuery, [req.session.userData.Cid], (err, servicesData, fields) => {
  //     if (err) {
  //       console.error(err);
  //       return res.status(500).send("Error fetching customer services data");
  //     }

  //     // Render the customerView.ejs view with user data, services data, and orders data
  //     res.render('customerView.ejs', { userData: req.session.userData, servicesData, ordersData });
  //   });
  // });
});



// Add this route to your existing Express app
app.post("/mark-as-received/:productId", (req, res) => {
  const customerId = req.session.userData.Cid;
  const productId = req.params.productId;

  console.log(customerId);
  console.log(productId);

  // Assuming you have an 'orders' table with an appropriate column for receipt confirmation
  const markAsReceivedQuery = `
    UPDATE orders
    SET received = true
    WHERE C_id = ? AND P_id = ?;
  `;

  pool.query(markAsReceivedQuery, [customerId, productId], (err, results, fields) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error marking product as received");
    }

    console.log("Product marked as received:", results);

    res.json({ success: true, message: "Product marked as received" });
  });
});


// Add this route to your existing Express app
app.post("/mark-service-as-received/:S_id/:M_id/:Day", (req, res) => {
  const customerId = req.session.userData.Cid;
  const serviceId = req.params.S_id;
  const mechanicId = req.params.M_id;
  const Day = req.params.Day;

  // Update availability in customers_services table
  const updateCustomerServiceAvailabilityQuery = `
    UPDATE customers_services
    SET received = 1
    WHERE C_id = ? AND S_id = ? AND M_id = ? AND Day = ?`;

  pool.query(
    updateCustomerServiceAvailabilityQuery,
    [customerId, serviceId, mechanicId, Day],
    (err, results) => {
      if (err) {
        console.error(err);
        return res.status(500).send("Error updating customer service availability");
      }

      console.log("Service marked as received");
      res.json({ success: true, message: "Service marked as received" });
    }
  );
});


app.post("/submitReview", async (req, res) => {
  console.log("Received submitReview request");
  const customerId = req.session.userData.Cid;
  const serviceId = req.body.S_id;
  const mechanicId = req.body.M_id;
  const day = req.body.Day; // Added to retrieve the Day value
  const { rating, comment } = req.body;

  console.log("customerId:", customerId);
  console.log("serviceId:", serviceId);
  console.log("mechanicId:", mechanicId);
  console.log("rating:", rating);
  console.log("comment:", comment);
  console.log("Day:", day);

  // Insert review data into the 'reviews' table
  const insertReviewQuery = `
    INSERT INTO reviews (customer_id, mechanic_id, service_id, rating, comment)
    VALUES (?, ?, ?, ?, ?)
  `;

  // Update customers_services table's reviewed column
  const updateReviewedQuery = `
    UPDATE customers_services
    SET reviewed = 1
    WHERE C_id = ? AND S_id = ? AND M_id = ? AND Day = ?;
  `;

  try {
    // Insert review data
    await pool.query(insertReviewQuery, [
      customerId,
      mechanicId,
      serviceId,
      rating,
      comment,
    ]);

    // Update customers_services table's reviewed column
    await pool.query(updateReviewedQuery, [customerId, serviceId, mechanicId, day]);

    // Redirect the user to the same page after submitting the review
    res.redirect('/customerView');
  } catch (error) {
    console.error("Error submitting review:", error);
    res.status(500).json({ success: false, error: "Error submitting review" });
  }
});



app.post("/login", (req, res) => {
  const { email, password, userType } = req.body;

  let tableName, redirectRoute, fetchServicesQuery, fetchDataQuery, userIdField;

  if (userType === 'mechanic') {
    tableName = 'mechanics';
    redirectRoute = 'mechanicView.ejs';
    fetchServicesQuery = `
    SELECT customers_services.S_id, services.services, customers_services.Day, mechanics.fullName AS mechanicName, customers.fullName AS customerName, customers_services.M_id AS M_id, customers_services.received
    FROM customers_services
    INNER JOIN services ON customers_services.S_id = services.Sid
    INNER JOIN mechanics ON customers_services.M_id = mechanics.Mid
    INNER JOIN customers ON customers_services.C_id = customers.Cid
    WHERE customers_services.C_id = ?;
  `;
    userIdField = 'Mid'; // Replace with the actual field name for mechanic ID
  } else if (userType === 'customer') {
    tableName = 'customers';
    redirectRoute = 'customerView.ejs';
    // Fetch customer services with received status and reviewed value
    const fetchServicesQuery = `
      SELECT customers_services.S_id, customers_services.reviewed, services.services, customers_services.Day, mechanics.fullName AS mechanicName, customers_services.M_id AS M_id, customers_services.received
      FROM customers_services
      INNER JOIN services ON customers_services.S_id = services.Sid
      INNER JOIN mechanics ON customers_services.M_id = mechanics.Mid
      WHERE customers_services.C_id = ?;
    `;
    // Fetch customer orders with product name
    const fetchOrdersQuery = `
      SELECT orders.*, products.name
      FROM orders
      INNER JOIN products ON orders.P_id = products.Pid
      WHERE C_id = ?;
    `;
    fetchDataQuery = [fetchServicesQuery, fetchOrdersQuery];
    userIdField = 'Cid'; // Replace with the actual field name for customer ID
  } else {
    console.log('Invalid user type');
    return res.status(400).send('Invalid user type');
  }

  // Check if the user with the provided email and password exists in the specified table
  const query = `SELECT * FROM ${tableName} WHERE email = ? AND password = ?`;

  pool.query(query, [email, password], (err, results, fields) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error checking login credentials");
    }

    if (results.length > 0) {
      // User found, login successful
      console.log("Login successful");

      // Store user data in the session
      req.session.userData = results[0];

      console.log("User data in session:", req.session.userData);

      if (!req.session.userData || !req.session.userData[userIdField]) {
        console.log('Invalid session data');
        return res.status(500).send('Invalid session data');
      }

      // Fetch additional data based on the user's type
      if (userType === 'customer') {
        const [fetchServicesQuery, fetchOrdersQuery] = fetchDataQuery;

        // Fetch customer services
        pool.query(fetchServicesQuery, [req.session.userData[userIdField]], (err, servicesData, fields) => {
          if (err) {
            console.error(err);
            return res.status(500).send("Error fetching customer services data");
          }

          // Fetch and include the reviewed value for each service
          const fetchReviewedQuery = `
            SELECT S_id, reviewed
            FROM customers_services
            WHERE C_id = ?;
          `;
          pool.query(fetchReviewedQuery, [req.session.userData[userIdField]], (err, reviewedData, fields) => {
            if (err) {
              console.error(err);
              return res.status(500).send("Error fetching reviewed data for customer services");
            }

            // Map reviewed data to servicesData
            const reviewedMap = new Map(reviewedData.map(item => [item.S_id, item.reviewed]));
            servicesData.forEach(service => {
              service.reviewed = reviewedMap.get(service.S_id) || false;
            });

            // Fetch customer orders
            pool.query(fetchOrdersQuery, [req.session.userData[userIdField]], (err, ordersData, fields) => {
              if (err) {
                console.error(err);
                return res.status(500).send("Error fetching customer orders data");
              }

              // Render the view with user data, services data, and orders data
              res.render(redirectRoute, { userData: req.session.userData, servicesData, ordersData });
            });
          });
        });
      } else if (userType === 'mechanic') {
        // Fetch mechanic services
        pool.query(fetchServicesQuery, [req.session.userData[userIdField]], (err, mechanicServicesData, fields) => {
          if (err) {
            console.error(err);
            return res.status(500).send(`Error fetching services data for ${userType}`);
          }

          // Render the view with user data and services data
          res.render(redirectRoute, { userData: req.session.userData, mechanicServicesData });
        });
      }
    } else {
      // User not found or invalid credentials
      console.log("Invalid email or password");
      res.status(401).send("Invalid email or password");
    }
  });
});




// Signup route
app.post("/signup", (req, res) => {
  const { fullName, email, password, phone, address } = req.body;

  // Insert user data into the customers table
  const signupQuery = `INSERT INTO customers (fullName, email, password, phone, address) VALUES (?, ?, ?, ?, ?)`;

  pool.query(signupQuery, [fullName, email, password, phone, address], (err, results, fields) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error signing up");
    }

    console.log("Signup successful");
    req.session.userData = { fullName, email, password, phone, address };

    // Redirect to the login page
    res.sendFile(__dirname + "/public/login_signup.html");
  });
});

// Fetch service names and available days
app.get("/services", (req, res) => {
  // Fetch service names from the services table
  const fetchServicesQuery = "SELECT services, price FROM services";

  pool.query(fetchServicesQuery, (err, services, fields) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error fetching service names");
    }

    // Fetch distinct available days from the mechanics_shift table where availability is 1
    const fetchAvailableDaysQuery = "SELECT DISTINCT days FROM mechanics_shift WHERE availability > 0";

    pool.query(fetchAvailableDaysQuery, (err, availableDays, fields) => {
      if (err) {
        console.error(err);
        return res.status(500).send("Error fetching available days");
      }

      // Pass service names and available days to the template
      res.render('Services.ejs', { services, availableDays });
    });
  });
});

// Fetch mechanics based on the selected day
app.get('/mechanics', (req, res) => {
  const selectedDay = req.query.selectedDay;

  const fetchMechanicsQuery = `
    SELECT m.Mid, m.fullName, AVG(r.rating) AS averageRating
    FROM mechanics m
    LEFT JOIN reviews r ON m.Mid = r.mechanic_id
    WHERE m.Mid IN (SELECT M_id FROM mechanics_shift WHERE days = ? AND availability > 0)
    GROUP BY m.Mid, m.fullName
  `;

  pool.query(fetchMechanicsQuery, [selectedDay], (err, mechanics, fields) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Error fetching mechanics' });
    }

    res.json(mechanics);
  });
});


// /submitCustomerForm route
app.post("/submitCustomerForm", (req, res) => {
  const { selectedServices, selectedDay, selectedMechanic } = req.body;

  // Check if userData is present in the session
  if (!req.session.userData || !req.session.userData.email) {
    return handleError(res, "User data not found in the session");
  }

  // Use the email from the session to find Cid
  const userEmail = req.session.userData.email;
  const findCidQuery = 'SELECT Cid FROM customers WHERE email = ?';

  pool.query(findCidQuery, [userEmail], (err, results, fields) => {
    if (err) return handleError(res, "Error finding customer ID");
    if (results.length === 0) return handleError(res, "Customer not found");

    const cid = results[0].Cid;

    const selectServiceQuery = 'SELECT Sid, price FROM services WHERE services = ?';
    const insertQuery = 'INSERT INTO customers_services (C_id, S_id, M_id, Day, price) VALUES (?, ?, ?, ?, ?)';
    const decrementAvailabilityQuery = 'UPDATE mechanics_shift SET availability = availability - 1 WHERE M_id = ? AND days = ? AND availability > 0';

    let servicesProcessed = 0;
    const totalServices = Array.isArray(selectedServices) ? selectedServices.length : 1;

    const processService = (service) => {
      pool.query(selectServiceQuery, [service], (err, results, fields) => {
        if (err) return handleError(res, "Error selecting service information from services table");
        if (results.length === 0) return handleError(res, `Service not found: ${service}`);

        const { Sid, price } = results[0];

        pool.query(insertQuery, [cid, Sid, selectedMechanic, selectedDay, price], (err, results, fields) => {
          if (err) return handleError(res, "Error inserting into customers_services table");

          pool.query(decrementAvailabilityQuery, [selectedMechanic, selectedDay], (err, results, fields) => {
            if (err) return handleError(res, "Error decrementing mechanic availability");

            servicesProcessed++;

            // Send the response after processing all services
            if (servicesProcessed === totalServices) {
              console.log('Form submitted successfully');
              res.redirect('/customerView');
              // res.render('customerView.ejs');
            }
          });
        });
      });
    };

    if (Array.isArray(selectedServices) && selectedServices.length >= 1) {
      selectedServices.forEach(processService);
    } else {
      // If only one service is selected, directly process it
      processService(selectedServices);
    }
  });
});


function handleError(res, errorMessage) {
  console.error(errorMessage);
  res.status(500).send(errorMessage);
}

// Signout route
app.get("/signout", (req, res) => {
  // Clear the session
  req.session.destroy((err) => {
    if (err) {
      console.error(err);
    }
    res.sendFile(__dirname + "/public/login_signup.html");
  });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
