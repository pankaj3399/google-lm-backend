import express from "express";
import connectDB from "./config/db";
import userRoutes from "./routes/user";
// import { clerkMiddleware } from "./middleware/clerkMiddleware";
import { clerkMiddleware } from '@clerk/express'
import dotenv from "dotenv";
import cors from "cors";


dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const API_URL = process.env.API_URL;

// Middleware
app.use(express.json());
app.use(clerkMiddleware()); // Apply Clerk middleware

app.use(
    cors({
        origin: API_URL,
        credentials: true,
    })
);

// Connect to MongoDB
connectDB();

// Routes
app.use("/api/users", userRoutes);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});