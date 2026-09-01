import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const AUTH_COOKIE_NAME = "authToken";

const safeUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const getCookieMaxAge = () => {
  const expiresIn = process.env.JWT_EXPIRES_IN || "7d";
  const match = /^(\d+)([smhd])$/.exec(expiresIn);

  if (!match) {
    return undefined;
  }

  const value = Number(match[1]);
  const unit = match[2];
  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit];
};

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  maxAge: getCookieMaxAge(),
});

const signToken = (userId) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not defined");
  }

  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
};

const sendAuthCookie = (res, token) => {
  res.cookie(AUTH_COOKIE_NAME, token, cookieOptions());
};

const validateRegistration = ({ name, email, password }) => {
  if (!name || !email || !password) {
    return "Name, email, and password are required";
  }

  if (String(name).trim().length < 2) {
    return "Name must be at least 2 characters";
  }

  if (!/^\S+@\S+\.\S+$/.test(String(email).trim())) {
    return "Please provide a valid email";
  }

  if (String(password).length < 8) {
    return "Password must be at least 8 characters";
  }

  return null;
};

const validateLogin = ({ email, password }) => {
  if (!email || !password) {
    return "Email and password are required";
  }

  return null;
};

export const register = async (req, res) => {
  try {
    const validationError = validateRegistration(req.body);

    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const name = String(req.body.name).trim();
    const email = String(req.body.email).trim().toLowerCase();
    const password = String(req.body.password);

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(409).json({ message: "Email is already registered" });
    }

    const user = await User.create({ name, email, password });
    const token = signToken(user._id);

    sendAuthCookie(res, token);

    return res.status(201).json({
      message: "Registration successful",
      user: safeUser(user),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Email is already registered" });
    }

    console.error("Register error:", error.message);
    return res.status(500).json({ message: "Unable to register user" });
  }
};

export const login = async (req, res) => {
  try {
    const validationError = validateLogin(req.body);

    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const email = String(req.body.email).trim().toLowerCase();
    const password = String(req.body.password);
    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const passwordMatches = await user.comparePassword(password);

    if (!passwordMatches) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = signToken(user._id);

    sendAuthCookie(res, token);

    return res.status(200).json({
      message: "Login successful",
      user: safeUser(user),
    });
  } catch (error) {
    console.error("Login error:", error.message);
    return res.status(500).json({ message: "Unable to log in" });
  }
};

export const logout = async (req, res) => {
  try {
    res.clearCookie(AUTH_COOKIE_NAME, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    });

    return res.status(200).json({ message: "Logout successful" });
  } catch (error) {
    console.error("Logout error:", error.message);
    return res.status(500).json({ message: "Unable to log out" });
  }
};

export const me = async (req, res) => {
  try {
    return res.status(200).json({ user: safeUser(req.user) });
  } catch (error) {
    console.error("Me error:", error.message);
    return res.status(500).json({ message: "Unable to fetch current user" });
  }
};
