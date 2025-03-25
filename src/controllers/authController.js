const User = require('../models/userModel');
const otpUtils = require('../utils/otpUtils');
const twilio = require('twilio');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const accountSid = 'AC4a77cf305a2524932ee4b63f89792ebd';
const authToken = '825b4667ed49063ff9d16c984420b6b6';
const twilioPhoneNumber = '+19787231027';
const jwtSecret = 'a95a996b6508abb29bfd9e47c0a4b4033aa7baae4a35ecce1aed4e90456ddde3bb771abbb1168501bd351ffbe40edfac5f9bc142556fa5f3929e3691b420cab3d595c84c2fa352f851692b825235c127a24a7b4212cc635b76186001e7f3c7f6cd09bc45e9b0a8ed775b7510ba5d1cc79e0091d26ffbd4d2975e3ca96fbfbf2b51f2fe26874a97e23394599791bf6378ca0189e47e67fe3a42342f08d27d7c87df80d742ba81defa4d2924d3e936b5df45b44f8509bc91dc8758e318e785b222c16f09a0ed7ca1ee10f962a4e829e1c8db9ac1e0f5b812c6b8ac78d290bc6c761b155b456e497d77ee21e1898e7074228192b9634029bb2494d2cde3d0ac9fb7';

const client = new twilio(accountSid, authToken);
const otps = {};

const signup = async (req, res) => {
    try {
        console.log('Signup request body:', req.body);

        const { name, email, password, adharNumber, phoneNumber, voterId } = req.body;

        if (!password) {
            return res.status(400).json({ error: "Password is required" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        console.log('Hashed Password:', hashedPassword); // Log hashed password

        const user = new User({ 
            name, 
            email, 
            password: hashedPassword, 
            adharNumber, 
            phoneNumber, 
            voterId, 
            phoneNumberVerified: false 
        });

        await user.save();
        res.status(201).json({ message: 'Signup successful. Please verify OTP.' });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: error.message });
    }
};


const moment = require('moment');
const sendOTP = async (req, res) => {
    const { phoneNumber } = req.body;
    const otp = otpUtils.generateOTP();
    try {
        console.log("phoneNumber from request:", phoneNumber);
        console.log('Sending OTP to:', phoneNumber);
        console.log('Twilio Account SID:', accountSid);
        console.log('Twilio Auth Token:', authToken);
        console.log('Twilio Phone Number:', twilioPhoneNumber);

        await client.messages.create({
            body: `Your OTP is: ${otp}`,
            from: twilioPhoneNumber,
            to: phoneNumber,
        });

        const expiresAt = moment().add(5, 'minutes').toDate();
        otps[phoneNumber] = { otp, expiresAt };
        res.json({ message: 'OTP sent successfully.' });
    } catch (error) {
        console.error('Error sending OTP:', error);
        console.error('Twilio error details:', error.message, error.code);
        res.status(500).json({ error: 'Failed to send OTP.' });
    }
};


const verifyOTP = async (req, res) => {
    const { phoneNumber, otp } = req.body;
    const storedOtpData = otps[phoneNumber];

    if (!storedOtpData || !storedOtpData.otp) {
        return res.status(400).json({ error: "OTP expired or invalid." });
    }

    if (storedOtpData.otp !== otp) {
        return res.status(400).json({ error: "Invalid OTP." });
    }

    if (!moment().isBefore(storedOtpData.expiresAt)) {
        return res.status(400).json({ error: "OTP has expired." });
    }

    delete otps[phoneNumber]; // Remove OTP after use

    try {
        const existingUser = await User.findOne({ phoneNumber });
        if (!existingUser) {
            return res.status(404).json({ error: "User not found. Please sign up first." });
        }

        const updatedUser = await User.findOneAndUpdate(
            { phoneNumber },
            { phoneNumberVerified: true },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(500).json({ error: "Failed to update verification status." });
        }

        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        return res.status(200).json({ message: "Phone number successfully verified!", token });
    } catch (dbError) {
        console.error("Database error during OTP verification: ", dbError);
        return res.status(500).json({ error: "Database error" });
    }
};


const verifyOTPAndGetUID = async (req, res) => {
    console.log('verifyOTPAndGetUID called:', req.body);
    const { phoneNumber, otp } = req.body;
    const storedOtpData = otps[phoneNumber];

    if (storedOtpData && storedOtpData.otp === otp) {
        if(moment().isBefore(storedOtpData.expiresAt)){
            delete otps[phoneNumber];
            try {
                const user = await User.findOne({ phoneNumber });
                console.log('User from database:', user);
                if (!user) {
                    return res.status(404).json({ error: 'User not found with this phone number.' });
                }
                return res.status(200).json({ message: 'Phone number successfully verified!', user: user });
            } catch (dbError) {
                console.error("Database error during OTP verification: ", dbError);
                return res.status(500).json({ error: 'Database error during OTP verification.' });
            }
        } else {
            return res.status(400).json({error: "OTP has expired."});
        }
    } else {
        return res.status(400).json({ error: 'Invalid OTP.' });
    }
};


// In your authController.js
const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email }).select('+password');
        if (!user || !user.password) {
            return res.status(401).json({ error: "Invalid Credentials" });
        }
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: "Invalid Credentials" });
        }
        const token = jwt.sign({ userId: user._id }, jwtSecret, { expiresIn: '1h' });
        res.status(200).json({ 
            token,
            userId: user._id.toString(),
            phoneNumber: user.phoneNumber,
            isAdmin: user.isAdmin
        });
    } catch (err) {
        res.status(500).json({ error: "Login failed" });
    }
};

const adminLogin = async (req, res) => {
    try {
        console.log('Admin login attempt:', req.body);
        const { email, password } = req.body;
        
        const user = await User.findOne({ email, isAdmin: true }).select('+password');
        console.log('Admin user found:', user ? 'Yes' : 'No');
        
        if (!user || !user.password) {
            console.log('No admin user found or password is missing');
            return res.status(401).json({ error: "Invalid admin credentials" });
        }
        
        const passwordMatch = await bcrypt.compare(password, user.password);
        console.log('Password match:', passwordMatch);
        
        if (!passwordMatch) {
            console.log('Password does not match');
            return res.status(401).json({ error: "Invalid admin credentials" });
        }
        
        const token = jwt.sign({ 
            userId: user._id,
            isAdmin: true 
        }, jwtSecret, { expiresIn: '1h' });
        
        console.log('Admin login successful, token generated');
        
        res.status(200).json({ 
            token,
            userId: user._id.toString(),
            isAdmin: true
        });
    } catch (err) {
        console.error('Admin login error:', err);
        res.status(500).json({ error: "Admin login failed" });
    }
};

const generateToken = (userId) => {
    return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "1h" });
};

const refreshToken = async (req, res) => {
    try {
        const oldToken = req.header("Authorization")?.split(" ")[1];
        if (!oldToken) {
            return res.status(401).json({ message: "No token provided." });
        }

        const decoded = jwt.verify(oldToken, process.env.JWT_SECRET, { ignoreExpiration: true });
        const newToken = generateToken(decoded.userId);

        res.status(200).json({ token: newToken });
    } catch (error) {
        console.error("Refresh Token Error:", error);
        res.status(401).json({ message: "Invalid refresh request." });
    }
};



module.exports = { signup, sendOTP, verifyOTP, verifyOTPAndGetUID, login, adminLogin, refreshToken  };