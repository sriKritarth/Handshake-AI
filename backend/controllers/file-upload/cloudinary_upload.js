const supabase = require("../../config/db");

const cloudinary = require("cloudinary").v2;


function isFileSupported(file_ext, supportedFiles) {
    return supportedFiles.includes(file_ext);
}

async function uploadCloudinary(file, folder, quality) {
    const options = {
        folder: folder,
        use_filename: true,
        resource_type: "auto"
    };

    if (quality) {
        options.quality = quality;
        return cloudinary.uploader.upload(file.tempFilePath, options);
    }
    return cloudinary.uploader.upload(file.tempFilePath, options);
}

exports.imageUpload = async (req, res) => {
    try {
        const { sku_code } = req.params
        const {file}  = req.files;


        const supportedFiles = ["jpg", "jpeg", "png" , "webp"];
        const file_ext = file.name.split('.')[1];

        if (!isFileSupported(file_ext, supportedFiles)) {
            return res.status(200).json({
                success: false,
                message: "File type not supported"
            })
        }

        const response = await uploadCloudinary(file, "utils");
        // console.log(response);


        const {error } = await supabase.from('catalog_skus').update({ "Image_url": response.secure_url }).eq( "sku_code" ,  sku_code );

        if (error) {
            console.log(error.message);
            return res.status(501).json({
                success : false,
                message : error.message
            })
        }

        return res.status(200).json({
            succcess: true,
            message: "File saved to cloudinary successfully"
        })



    }
    catch (error) {
        console.log(error);
        return res.status(500).json({
            success: false,
            message: "Unable to save data",
            data: error.message
        })
    }
}

