const supabase = require("../../config/db.js")
require('dotenv').config()

exports.getAllCatalog = async function (req , res){
    try{
        const {data , error} = await supabase.from('catalog_skus').select("sku_code , name , category , description , base_price , Image_url").order("name" , {ascending : true})
        if (error) {
            return res.status(500).json({
                success: false,
                message: error.message || "Failed to retrieve catalog items",
            });
        }


        return res.status(200).json({
            success: true,
            count: data ? data.length : 0,
            data: data ,
            message: "Catalog retrieved successfully",
        });
    }
    catch (err){
        return res.status(500).json({
            success : false,
            message : err.message
        })
    }
    
};

exports.getCatalogbysku = async function (req , res){
    try{
        const {sku_code} = req.params;
        const {data , error} = await supabase.from('catalog_skus').select("sku_code , name , category , description , base_price , Image_url").eq('sku_code' , sku_code).maybeSingle()

        if (error) {
            return res.status(500).json({
                success: false,
                message: error.message || "Failed to query catalog item",
            });
        }
    

        if(!data){
            return res.status(404).json({
                success : false,
                message : "Invalid Sku"
            })
        }
  

        return res.status(200).json({
            success : true,
            data : data,
            message : "Data retrieved Successfully"
        })
    }
    catch(err){
        return res.status(500).json({
            success : false,
            message : err.message
        })
    }
}


