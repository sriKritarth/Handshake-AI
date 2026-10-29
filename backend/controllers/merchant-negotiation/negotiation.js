const supabase = require("../../config/db");
const negotiationService = require("../../features/negotiation/negotiationService");
require("dotenv").config();

exports.getPendingsesssions = async function (req, res) {
    try {
        const { data, error } = await supabase.from('merchant_approvals').select("*").eq("status", "PENDING").order("created_at", { ascending: false });
        if (error) {
            return res.status(502).json({
                success: false,
                message: error.message || null
            })
        }

        if (!data || data.length === 0) {
            return res.status(200).json({
                success: true,
                message: "No pending request found",
                data: [] // Always return an array to prevent frontend crashes
            });
        }
        const now = Date.now();
        const expiredApprovalIds = [];
        const expiredSessionIds = [];
        const activePending = [];
        // 2. Partition into active vs expired (30-minute SLA window)
        for (const row of data) {
            const diffMs = now - new Date(row.created_at).getTime();
            if (diffMs > 30 * 60 * 1000) {
                expiredApprovalIds.push(row.id);
                if (row.session_id) expiredSessionIds.push(row.session_id);
            } else {
                activePending.push(row);
            }
        }
        // 3. Batch update expired records in 1 single round-trip (no N+1 loops)
        if (expiredApprovalIds.length > 0) {
            const nowIso = new Date().toISOString();
            await Promise.all([
                supabase
                    .from("merchant_approvals")
                    .update({
                        status: "REJECTED",
                        responded_at: nowIso,
                        merchant_notes: "Auto-rejected: Approval request exceeded 30-minute window"
                    })
                    .in("id", expiredApprovalIds),
                supabase
                    .from("negotiation_sessions")
                    .update({
                        status: "REJECTED",
                        updated_at: nowIso
                    })
                    .in("id", expiredSessionIds)
            ]);
        }
        // 4. Return only genuinely pending, active requests
        return res.status(200).json({
            success: true,
            message: activePending.length > 0 ? "Data retrieved successfully" : "No pending request found",
            data: activePending
        })
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({
            success: false,
            message: error.message
        })
    }
}


exports.counterApprove = async function (req, res) {
    try {
        const { session_id } = req.params;
        const { data, error } = await supabase.from('merchant_approvals').select("*").match({ session_id: session_id, status: "PENDING" }).maybeSingle();
        if (error) {
            return res.status(502).json({
                success: false,
                message: error.message || null
            })
        }

        if (!data) {
            return res.status(404).json({
                success: false,
                message: `No pending approval found for session ${session_id}`
            });
        }


        //session id present
        let validactions = ["approve", "reject", "counter"];
        const { action, counter_price, merchant_notes } = req.body;
        

        const normalizedAction = String(action).toLowerCase().trim();
        if (!normalizedAction || !validactions.includes(normalizedAction)) {
            return res.status(400).json({
                success: false,
                message: "Invalid action. Must be 'approve', 'reject', or 'counter'."
            });
        }


        // 3. Counter price is only mandatory for "counter"
        if (normalizedAction === "counter") {

            if(!counter_price || isNaN(counter_price) || counter_price <= 0){
                return res.status(400).json({
                    success: false,
                    message: "A positive 'counter_price' is required when action is 'counter'."
                });
            }

        }

        let price ;
        if(normalizedAction !== "counter"){
            price = Number.parseFloat(data.requested_price);
        }


        const result = await negotiationService.handleMerchantDecision({
            sessionId: session_id,
            action: normalizedAction,
            counterPrice: normalizedAction === "counter" ? Number.parseFloat(counter_price) : price,
            merchantNotes: merchant_notes ? String(merchant_notes).trim() : null,
        });

        return res.status(200).json({
            success: true,
            data: result,
            message: "Merchant decision processed successfully",
        });


    }
    catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: error.message
        })
    }
}