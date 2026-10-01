const zod = require("zod");

exports.validate_email = function (email) {
    try{
        const emailValidator = zod.email();
        const validate = emailValidator.parse(email)
        const obj = {
            data : validate,
            success : true
        }

        return obj;
    }
    catch(err){
        console.log(err);
        const obj = {
            data : err,
            success : false
        }

        return obj
    }
}