const supabase = require("../../config/db")
require("dotenv").config()
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY

exports.getaudit = async function (req, res) {
    try {
        const { session_id } = req.params;
        let pythonResponse;

        try {
            pythonResponse = await fetch(`${PYTHON_SERVICE_URL}/api/v1/sessions/${session_id}/audit`, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    "X-API-Key": ADMIN_KEY,
                }
            })

        }
        catch (networkErr) {
            console.error("Python engine connection error:", networkErr.message);
            return res.status(502).json({
                success: false,
                message: "Negotiation engine is temporarily unreachable. Please try again shortly.",
            });
        }

        const responseData = await pythonResponse.json();
        if (!pythonResponse.ok) {
            return res.status(pythonResponse.status).json({
                success: false,
                message: responseData.detail || responseData.message || "Failed to initiate negotiation session",

            });
        }

        return res.status(200).json({
            success : true,
            data : responseData,
            message : "Data fetched successfully"
        })

    }
    catch (error) {
        console.log(error.message);
        return res.status(500).json({
            success: false,
            message: error.message
        })
    }
};



exports.replayChain = async function (req, res) {
    try {
        const { session_id } = req.params;


        let pythonResponse;

        try {
            pythonResponse = await fetch(`${PYTHON_SERVICE_URL}/api/v1/sessions/${session_id}/replay`, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    "X-API-Key": ADMIN_KEY,
                }
            })

        }
        catch (networkErr) {
            console.error("Python engine connection error:", networkErr.message);
            return res.status(502).json({
                success: false,
                message: "Negotiation engine is temporarily unreachable. Please try again shortly.",
            });
        }

       const responseData = await pythonResponse.json();
        if (!pythonResponse.ok) {
            return res.status(pythonResponse.status).json({
                success: false,
                message: responseData.detail || responseData.message || "Failed to initiate negotiation session",

            });
        }

        return res.status(200).json({
            success : true,
            data : responseData,
            message : "Data fetched successfully"
        })

    }
    catch (error) {
        console.log(error.message);
        return res.status(500).json({
            success: false,
            message: error.message
        })
    }
};



exports.verifyChain = async function (req, res) {
    try {
        const { session_id } = req.params;

        let pythonResponse;

        try {
            pythonResponse = await fetch(`${PYTHON_SERVICE_URL}/api/v1/sessions/${session_id}/verify`, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    "X-API-Key": ADMIN_KEY,
                }
            })

        }
        catch (networkErr) {
            console.error("Python engine connection error:", networkErr.message);
            return res.status(502).json({
                success: false,
                message: "Negotiation engine is temporarily unreachable. Please try again shortly.",
            });
        }

        const responseData = await pythonResponse.json();
        if (!pythonResponse.ok) {
            return res.status(pythonResponse.status).json({
                success: false,
                message: responseData.detail || responseData.message || "Failed to initiate negotiation session",

            });
        }

        return res.status(200).json({
            success : true,
            data : responseData,
            message : "Data fetched successfully"
        })

    }
    catch (error) {
        console.log(error.message);
        return res.status(500).json({
            success: false,
            message: error.message
        })
    }
};
