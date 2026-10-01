const express = require("express");
const cors = require('cors')
require("dotenv").config()

const app = express()

const port = process.env.PORT

//middleware
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));

app.use(cors());

const dbConnection = require("./config/db")
dbConnection;


// mount the routes

const routes = require("./routes/router")
app.use("/api/v1", routes);


app.listen(port, () => {
    console.log(`Listening at  port ${port}`)
})

app.get("/", (req, res) => {
    res.send("<h1> Server Started </h1>")
})


