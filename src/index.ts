import express from "express";
import connectDB from "./config/db";
import userRoutes from "./routes/user";
import dotenv from "dotenv";
import cors from "cors";
import { ClerkExpressWithAuth } from "@clerk/clerk-sdk-node";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const API_URL = process.env.API_URL;

app.use(express.json());
app.use(
    cors({
        origin: API_URL,
        credentials: true,
    })
);

// Clerk Middleware for Authentication
app.use(ClerkExpressWithAuth());

// Connect to MongoDB
connectDB();

// Routes
app.use("/api/users", userRoutes);

app.get("/", (req, res) => {
    res.send("Hello, World!");
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
