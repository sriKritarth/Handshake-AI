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

// Keep-Alive Heartbeat: Pings Python FastAPI service every 12 minutes to prevent cold starts
const PYTHON_SERVICE_URL = (process.env.PYTHON_SERVICE_URL);
if (PYTHON_SERVICE_URL) {
  setInterval(() => {
    fetch(`${PYTHON_SERVICE_URL}/api/v1/health`)
      .then(() => console.log("💓 Keep-alive ping sent to Python engine"))
      .catch((err) => console.warn("Keep-alive ping failed:", err.message));
  }, 14 * 60 * 1000); // 14 minutes
}


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


