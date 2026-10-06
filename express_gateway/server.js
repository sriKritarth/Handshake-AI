const express = require("express");
const cors = require('cors')
require("dotenv").config()
const fileUpload = require("express-fileupload")

const app = express()

const port = process.env.PORT

//middleware
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));


app.use(cors(
    {
        origin : ["https://handshake-ai-tau.vercel.app" , "http://localhost:5173"],
        credentials : true
    }
));


app.use(fileUpload({                              
    useTempFiles: true,
    tempFileDir: "/tmp/"
}));

const dbConnection = require("./config/db")
dbConnection;

const {cloudConnect} = require("./config/cloudinary");
cloudConnect();


// mount the routes

const routes = require("./routes/router")
app.use("/api/v1", routes);


app.listen(port, () => {
    console.log(`Listening at  port ${port}`)
})

app.get("/", (req, res) => {
    res.send("<h1> Server Started </h1>")
})


