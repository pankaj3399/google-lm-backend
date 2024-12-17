import { Request, Response } from "express";
import User from "../models/User";
import Workspace from "../models/Workspace";
import Note from "../models/Note";
import mongoose from "mongoose";
import {
    getContentThroughUrl,
    summarizeContent,
    uploadFiles,
    extractTextFromFile,
    respondToConversation,
    summarizeWorkspace,
    pullDataAnalysis,
    suggetionChat,
} from "../services/Source";
import Source from "../models/Source";
import axios from "axios";
import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();

const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    process.env.REDIRECT_URI
);

export const createUser = async (req: Request, res: Response) => {
    const { email, clerkId } = req.body;

    try {
        const newUser = new User({
            clerkId,
            email,
        });
        await newUser.save();
        res.status(201).json({ newUser, message: "Successfully Signed In" });
    } catch (error) {
        res.status(500).json({ message: "Error saving user data" });
    }
};

export const getUser = async (req: Request, res: Response) => {
    const { clerkId } = req.params;

    try {
        const user = await User.findOne({ clerkId });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        res.status(200).json({ user, message: "Logged in succssfully" });
    } catch (error) {
        res.status(500).json({ message: "Error fetching user data" });
    }
};

export const saveOpenAikey = async (req: Request, res: Response) => {
    const { clerkId } = req.params;
    const { api_key } = req.body;

    try {
        const user = await User.findOne({ clerkId });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        user.openAikey = api_key;
        await user.save();

        res.status(200).json({
            message: "API saved successfully",
            api: user.openAikey === "" ? false : true,
            googleAnalytics: user.googleAnalytics === "" ? false : true,
            propertyId: user.propertyId === "" ? false : true,
        });
    } catch (error) {
        res.status(500).json({ message: "Error fetching user data" });
    }
};

export const getOpenAikey = async (req: Request, res: Response) => {
    const { clerkId } = req.params;

    try {
        const user = await User.findOne({ clerkId });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        res.status(200).json({
            message: "API saved successfully",
            api: user.openAikey === "" ? false : true,
            googleAnalytics: user.googleAnalytics === "" ? false : true,
            propertyId: user.propertyId === "" ? false : true,
        });
    } catch (error) {
        res.status(500).json({ message: "Error fetching user data" });
    }
};

export const createNewWorkspace = async (req: Request, res: Response) => {
    const { workspaceName } = req.body;
    const { clerkId } = req.params;
    try {
        const user = await User.findOne({ clerkId });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const newWorkspace = new Workspace({
            name: workspaceName,
        });
        await newWorkspace.save();

        user.workspaces.push(newWorkspace._id as mongoose.Types.ObjectId);
        await user.save();

        res.status(201).json({
            message: "Workspace created successfully",
            workspace: newWorkspace,
        });
    } catch (err) {
        res.status(500).json({ message: "Error while creating workspace" });
    }
};

export const getAllWorkspaces = async (req: Request, res: Response) => {
    const { clerkId } = req.params;
    try {
        const user = await User.findOne({ clerkId })
            .populate({
                path: "workspaces",
                select: "-notes, -source",
            })
            .lean();
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        res.status(200).json({
            workspaces: user.workspaces,
            message: "Workspace Fetched",
        });
    } catch (err) {
        res.status(500).json({ message: "Error while fetching workspaces" });
    }
};

export const getWorkspace = async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    try {
        const workspace = await Workspace.findOne({ _id: workspaceId });
        if (!workspace) {
            return res.status(404).json({ message: "Workspace not found" });
        }

        res.status(200).json({ workspace });
    } catch (err) {
        res.status(500).json({ message: "Error while fetching workspaces" });
    }
};

export const createNewNote = async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const { heading, content, type } = req.body;

    try {
        const workspace = await Workspace.findById(workspaceId);
        if (!workspace) {
            return res.status(404).json({ message: "Workspace not found" });
        }

        const newNote = new Note({
            heading,
            content,
            type,
        });

        const savedNote = await newNote.save();

        workspace.notes.push(savedNote._id as mongoose.Types.ObjectId);
        await workspace.save();

        res.status(201).json({
            savedNote,
            message: "Note created successfully",
        });
    } catch (error) {
        console.error("Error creating note:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
};

export const getAllNotes = async (req: Request, res: Response) => {
    const { workspaceId } = req.params;

    try {
        const workspace = await Workspace.findOne({
            _id: workspaceId,
        }).populate("notes");
        if (!workspace) {
            return res.status(404).json({ message: "Workspace not found" });
        }

        res.status(200).json(workspace.notes);
    } catch (error) {
        console.error("Error fetching notes:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
};

function splitContent(content: string, chunkSize: number = 10000): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < content.length; i += chunkSize) {
        chunks.push(content.slice(i, i + chunkSize));
    }
    return chunks;
}

async function summarizeLargeContent(content: string, apiKey: string): Promise<string> {
    const chunks = splitContent(content);

    let finalSummary = "";

    for (const chunk of chunks) {
        const summary = await summarizeContent(chunk, apiKey);
        finalSummary += summary + "\n\n";  
    }

    return finalSummary.trim();  
}

export const createSource = async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const { url, uploadType, clerkId } = req.body;
    const file = (req.file as Express.Multer.File) ?? null;

    try {
        const workspace = await Workspace.findById(workspaceId);
        if (!workspace) {
            return res.status(404).json({ message: "Workspace not found" });
        }

        const user = await User.findOne({ clerkId });
        if (!user) {
            return res.json({ message: "User not found" });
        }
        if (user.openAikey === "") {
            return res
                .status(400)
                .json({ message: "Please provide woking OpenAi key" });
        }

        if (uploadType === "file" && req.file) {
            let fileUrl: string;
            try {
                fileUrl = await uploadFiles(file);
            } catch (error) {
                return res.status(400).json({
                    message:
                        "File upload failed. Please upload a smaller file or try again.",
                });
            }
            const content = await extractTextFromFile(file, user.openAikey);
            const summary = await summarizeLargeContent(content, user.openAikey);

            const newSource = new Source({
                url: fileUrl,
                summary,
                name: req.file.originalname.split(".").slice(0, -1).join("."),
                uploadType,
            });
            await newSource.save();

            workspace.sources.push(newSource._id as mongoose.Types.ObjectId);
            await workspace.save();

            return res.status(200).json({ newSource, message: "Source Added" });
        } else if (uploadType === "url" && url) {
            const content = await getContentThroughUrl(url);

            const summary = await summarizeLargeContent(content, user.openAikey);

            const newSource = new Source({
                url,
                summary,
                name: "URL Source",
                uploadType,
            });
            await newSource.save();

            workspace.sources.push(newSource._id as mongoose.Types.ObjectId);
            await workspace.save();

            return res.status(200).json({ newSource, message: "Source Added" });
        } else {
            return res.status(400).json({
                message: "Invalid input. Either a file or URL is required.",
            });
        }
    } catch (error) {
        console.error("Error creating source:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
};

export const getAllSources = async (req: Request, res: Response) => {
    const { workspaceId } = req.params;

    try {
        const workspace = await Workspace.findOne({
            _id: workspaceId,
        }).populate("sources");

        if (!workspace) {
            return res.status(404).json({ message: "Workspace not found" });
        }
        res.status(200).json(workspace.sources);
    } catch (error) {
        console.error("Error fetching notes:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
};

export const createConversation = async (req: Request, res: Response) => {
    const { context, question, clerkId } = req.body;
    const user = await User.findOne({ clerkId });
    if (!user) {
        return res.json({ message: "User not found" });
    }
    if (user.openAikey === "") {
        return res.status(400).json({ message: "Please provide woking OpenAi key" });
    }
    if (context === "," || question === "")
        return res.status(404).json({ message: "Please provide some context" });
    try {
        const resp = await respondToConversation({
            context,
            question,
            openAIApiKey: user.openAikey,
        });
        res.status(200).json({ message: resp });
    } catch (error) {
        console.error("Error fetching notes:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
};

export const createConversationOfSuggestion = async (
    req: Request,
    res: Response
) => {
    const { question, clerkId } = req.body;
    try {
        const user = await User.findOne({ clerkId });
        if (!user) {
            return res.json({ message: "User not found" });
        }
        if (user.openAikey === "") {
            return res.status(400).json({ message: "Please provide woking OpenAi key" });
        }
        const resp = await suggetionChat(question, user.openAikey);
        res.status(200).json({ message: resp });
    } catch (error) {
        console.error("Error fetching notes:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
};

export const updateNote = async (req: Request, res: Response) => {
    const { noteId } = req.params;
    const { heading, content } = req.body;
    try {
        const foundNote = await Note.findOne({ _id: noteId });

        if (!foundNote) {
            return res.status(404).json({ message: "Note not found" });
        }

        foundNote.heading = heading;
        foundNote.content = content;
        await foundNote.save();

        res.status(200).json({
            message: "Note updated successfully",
            note: foundNote,
        });
    } catch (error) {
        res.status(500).json({ message: "Failed to update note", error });
    }
};

export const googleAnalytics = async (req: Request, res: Response) => {
    const state = req.query.state;

    if (Array.isArray(state)) {
        return res.status(400).json({
            message:
                "Invalid state parameter: expected a single value, but got an array.",
        });
    }

    if (typeof state !== "string") {
        return res
            .status(400)
            .json({ message: "Invalid state parameter: expected a string." });
    }

    const parsedState = JSON.parse(decodeURIComponent(state));
    const clerkId = parsedState?.clerkId;

    if (!clerkId) {
        return res.status(400).json({ message: "Missing Clerk ID." });
    }

    try {
        // Exchange authorization code for access token
        const tokenResponse = await axios.post(
            "https://oauth2.googleapis.com/token",
            {
                code: req.query.code,
                client_id: process.env.CLIENT_ID,
                client_secret: process.env.CLIENT_SECRET,
                redirect_uri: `${process.env.BACKEND_URL}/api/users/oauth/google-analytics/callback`,
                grant_type: "authorization_code",
            }
        );

        const { access_token, refresh_token } = tokenResponse.data;

        // Find user by clerk ID
        const user = await User.findOne({ clerkId });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Save tokens in user record
        user.googleAnalytics = access_token;
        user.googleRefreshToken = refresh_token;
        await user.save();

        const redirectUrl =
            parsedState?.redirectUrl || `${process.env.API_URL}/home`;
        res.redirect(redirectUrl);
    } catch (error: any) {
        console.error(
            "OAuth Error:",
            error.response?.data || error.message || error
        );
        return res.status(500).json({
            message: "OAuth process failed.",
            details:
                error.response?.data ||
                error.message ||
                "Unknown error occurred",
        });
    }
};

export const getAllAccounts = async (req: Request, res: Response) => {
    const clerkId = req.query.clerkId as string;

    if (!clerkId) {
        return res.status(400).json({ message: "Clerk ID is required." });
    }

    try {
        const user = await User.findOne({ clerkId });
        if (!user) return res.status(404).json({ message: "User not found" });

        oauth2Client.setCredentials({
            access_token: user.googleAnalytics,
            refresh_token: user.googleRefreshToken,
        });

        const analyticsAdmin = google.analyticsadmin("v1beta");
        const accountsResponse = await analyticsAdmin.accounts.list({
            auth: oauth2Client,
        });

        const accounts = accountsResponse.data.accounts || [];
        res.json(accounts);
    } catch (error: any) {
        console.error("Error fetching GA4 accounts:", error);

        if (
            error.response?.data?.error === "invalid_grant" ||
            error.response?.data?.error_description?.includes("expired")
        ) {
            try {
                const user = await User.findOne({ clerkId });
                if (!user) {
                    return res.status(400).json({ message: "User not found" });
                }
                user.googleAnalytics = "";
                user.propertyId = "";
                user.googleRefreshToken = "";
                await user.save();
                res.status(400).json({
                    message: "Token expired, Link again Google Analytics..",
                });
            } catch (updateError) {
                console.error("Error removing tokens:", updateError);
            }
        }

        res.status(500).json({ message: "Failed to fetch accounts." });
    }
};

export const getGaProperties = async (req: Request, res: Response) => {
    const { clerkId, accountId } = req.query;

    if (!clerkId) {
        return res.status(400).json({ message: "Clerk ID is required." });
    }

    try {
        // Fetch the user from the database
        const user = await User.findOne({ clerkId });
        if (!user) return res.status(404).json({ message: "User not found." });

        oauth2Client.setCredentials({
            access_token: user.googleAnalytics,
            refresh_token: user.googleRefreshToken,
        });

        // Step 1: Fetch all accessible GA4 properties
        const analyticsAdmin = google.analyticsadmin("v1beta");
        const propertiesResponse = await analyticsAdmin.properties.list({
            filter: `parent:${accountId}`,
            auth: oauth2Client,
        });

        const properties = propertiesResponse.data.properties || [];
        if (!properties || properties.length === 0) {
            return res
                .status(404)
                .json({ message: "No GA4 properties found." });
        }

        // Return the list of properties
        res.json({ properties });
    } catch (error: any) {
        console.error("Error fetching GA4 properties:", error);

        // Check if error has specific details
        if (error.response) {
            return res
                .status(error.response.status)
                .json({ message: error.response.data });
        }

        res.status(500).json({ message: "Failed to fetch GA4 properties." });
    }
};

export const getGaReport = async (req: Request, res: Response) => {
    const { clerkId, propertyId } = req.query;

    // Validate required parameters
    if (!clerkId || !propertyId) {
        return res
            .status(400)
            .json({ message: "Clerk ID and Property ID are required." });
    }

    try {
        const user = await User.findOne({ clerkId });
        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        if (user.openAikey === "") {
            return res.status(400).json({ message: "Please provide OpenAI key" });
        }

        oauth2Client.setCredentials({
            access_token: user.googleAnalytics,
            refresh_token: user.googleRefreshToken,
        });

        const analyticsData = google.analyticsdata("v1beta");
        const reportResponse = await analyticsData.properties.runReport({
            auth: oauth2Client,
            property: propertyId as string,
            requestBody: {
                dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
                metrics: [
                    { name: "activeUsers" },
                    { name: "screenPageViews" },
                    { name: "eventCount" },
                    { name: "userEngagementDuration" },
                    { name: "sessions" },
                    { name: "newUsers" },
                    { name: "totalUsers" },
                ],
                dimensions: [{ name: "date" }],
                returnPropertyQuota: true,
            },
        });

        const analysis = await pullDataAnalysis(
            reportResponse.data,
            user.openAikey
        );

        const newNote = new Note({
            heading: "Google Analytics",
            content: analysis,
            type: "Analytics",
        });
        await newNote.save();

        let workspaceId: mongoose.Types.ObjectId;

        if (user.workspaces.length > 0) {
            workspaceId = user.workspaces[0];
            const workspace = await Workspace.findOne({ _id: workspaceId });
            workspace?.notes.push(newNote._id as mongoose.Types.ObjectId);
            await workspace?.save();
        } else {
            const newWorkspace = new Workspace({
                name: "New Workspace",
                notes: [newNote._id],
            });
            await newWorkspace.save();

            user.workspaces.push(newWorkspace._id as mongoose.Types.ObjectId);
        }

        user.propertyId = propertyId as string;
        await user.save();

        const userWorkspaces = await User.findOne({ clerkId })
            .populate({
                path: "workspaces",
                select: "-notes -source",
            })
            .lean();

        res.json({ workspace: userWorkspaces?.workspaces, propertyId: true });
    } catch (error: any) {
        console.error("Error fetching GA4 analytics report:", error);

        if (
            error.response?.data?.error === "invalid_grant" ||
            error.response?.data?.error_description?.includes("expired")
        ) {
            try {
                const user = await User.findOne({ clerkId });

                if (!user) {
                    return res.json({ message: "User not found" });
                }
                user.googleAnalytics = "";
                user.propertyId = "";
                user.googleRefreshToken = "";

                await user.save();
                return res.status(410).json({
                    message:
                        "Token expired. Please re-link your Google Analytics account.",
                });
            } catch (updateError) {
                console.error("Error removing expired tokens:", updateError);
            }
        }

        res.status(500).json({
            message: "Failed to fetch GA4 analytics report.",
        });
    }
};

export const getGaReportForWorkspace = async (req: Request, res: Response) => {
    const { clerkId, startDate, endDate, metrics } = req.body;

    if (
        !clerkId ||
        !startDate ||
        !endDate ||
        !metrics ||
        !Array.isArray(metrics)
    ) {
        return res.status(400).json({
            message:
                "Clerk ID, startDate, endDate, and metrics are required, and metrics must be an array.",
        });
    }

    try {
        const user = await User.findOne({ clerkId });
        if (!user) return res.status(404).json({ message: "User not found." });
        if (!user.propertyId)
            return res.status(400).json({
                message:
                    "Please select any analytics account from the home page.",
            });

        if (user.openAikey === "") {
            return res.status(400).json({ message: "Please provide woking OpenAi key" });
        }

        oauth2Client.setCredentials({
            access_token: user.googleAnalytics,
            refresh_token: user.googleRefreshToken,
        });

        const analyticsData = google.analyticsdata("v1beta");

        const reportResponse = await analyticsData.properties.runReport({
            auth: oauth2Client,
            property: user.propertyId,
            requestBody: {
                dateRanges: [{ startDate, endDate }],
                metrics: metrics.map((metric: string) => ({ name: metric })), // Map metrics to expected format
                dimensions: [{ name: "date" }],
                returnPropertyQuota: true,
            },
        });

        const analysis = await pullDataAnalysis(
            reportResponse.data,
            user.openAikey
        );

        res.json(analysis);
    } catch (error: any) {
        console.error("Error fetching GA4 analytics report:", error);

        if (
            error.response?.data?.error === "invalid_grant" ||
            error.response?.data?.error_description?.includes("expired")
        ) {
            try {
                const user = await User.findOne({ clerkId });

                if (!user) {
                    return res.json({ message: "User not found" });
                }
                user.googleAnalytics = "";
                user.propertyId = "";
                user.googleRefreshToken = "";

                await user.save();
                return res.status(410).json({
                    message:
                        "Token expired. Please re-link your Google Analytics account.",
                });
            } catch (updateError) {
                console.error(
                    "Error removing tokens from database:",
                    updateError
                );
            }
        }

        res.status(500).json({
            message: "Failed to fetch GA4 analytics report.",
        });
    }
};

export const generateReport = async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const { startDate, endDate, generateReportText, clerkId } = req.body;

    // Validate date inputs
    if (!startDate || !endDate) {
        return res
            .status(400)
            .json({ message: "Start date and end date are required." });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ message: "Invalid date format." });
    }

    if (start > end) {
        return res
            .status(400)
            .json({ message: "Start date cannot be greater than end date." });
    }

    try {
        const workspace = await Workspace.findById(workspaceId)
            .populate("notes")
            .populate("sources");

        if (!workspace) {
            return res.status(404).json({ message: "Workspace not found." });
        }
        const user = await User.findOne({ clerkId });
        if (!user) {
            return res.json({ message: "User not found" });
        }
        if (user.openAikey === "") {
            return res.status(400).json({ message: "Please provide woking OpenAi key" });
        }

        const filteredNotes = workspace.notes.filter((note: any) => {
            const noteDate = new Date(note.createdAt);
            return noteDate >= start && noteDate <= end;
        });

        const filteredSources = workspace.sources.filter((source: any) => {
            const sourceDate = new Date(source.createdAt);
            return sourceDate >= start && sourceDate <= end;
        });

        const notesContent = filteredNotes.map((note: any) => note.content);
        const sourcesContent = filteredSources.map(
            (source: any) => source.summary
        );

        const summary = await summarizeWorkspace({
            notes: notesContent,
            sources: sourcesContent,
            workspaceName: workspace.name,
            generateReportText,
            openAIApiKey: user.openAikey,
        });

        res.json({ summary });
    } catch (error) {
        console.error("Error generating report:", error);
        res.status(500).json({
            message: "An error occurred while generating the report.",
        });
    }
};

export const deleteNote = async (req: Request, res: Response) => {
    const { noteIds, workspaceId } = req.body;

    if (!noteIds || !Array.isArray(noteIds)) {
        return res.status(400).json({
            message: "Invalid payload. Expected an array of note IDs.",
        });
    }

    try {
        const result = await Note.deleteMany({ _id: { $in: noteIds } });

        if (result.deletedCount === 0) {
            return res
                .status(404)
                .json({ message: "No notes found to delete." });
        }

        if (workspaceId) {
            const workspaceUpdate = await Workspace.findByIdAndUpdate(
                workspaceId,
                { $pull: { notes: { $in: noteIds } } },
                { new: true }
            );

            if (!workspaceUpdate) {
                return res
                    .status(404)
                    .json({ message: "Workspace not found." });
            }
        }

        res.status(200).json({
            message: "Notes deleted successfully and removed from workspace.",
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Internal server error." });
    }
};

export const renameSource = async (req: Request, res: Response) => {
    const { _id, name } = req.body;

    // Validate input
    if (!_id || !name) {
        return res.status(400).json({
            message: "Invalid request. '_id' and 'name' are required.",
        });
    }

    try {
        // Find the source by _id and update its name
        const updatedSource = await Source.findByIdAndUpdate(
            _id,
            { name },
            { new: true } // Return the updated document
        );

        if (!updatedSource) {
            return res.status(404).json({
                message: "Source not found.",
            });
        }

        res.status(200).json({
            message: "Source renamed successfully.",
            source: updatedSource,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Internal server error.",
        });
    }
};

export const removeSource = async (req: Request, res: Response) => {
    const { _id, workspaceId } = req.body;

    if (!_id) {
        return res.status(400).json({
            message: "Invalid request. '_id' is required.",
        });
    }

    try {
        const deletedSource = await Source.findByIdAndDelete(_id);

        if (!deletedSource) {
            return res.status(404).json({
                message: "Source not found.",
            });
        }

        // If workspaceId is provided, remove the source reference from the workspace
        if (workspaceId) {
            const updatedWorkspace = await Workspace.findByIdAndUpdate(
                workspaceId,
                { $pull: { sources: _id } }, // Remove the source reference
                { new: true } // Return the updated document
            );

            if (!updatedWorkspace) {
                return res.status(404).json({
                    message: "Workspace not found.",
                });
            }
        } else {
            // If no specific workspaceId is provided, remove the source reference from all workspaces
            await Workspace.updateMany(
                { sources: _id },
                { $pull: { sources: _id } } // Remove the source reference
            );
        }

        res.status(200).json({
            message: "Source removed successfully.",
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Internal server error.",
        });
    }
};

export const renameWorkspace = async (req: Request, res: Response) => {
    const { _id, name } = req.body;

    // Validate input
    if (!_id || !name) {
        return res.status(400).json({
            message: "Invalid request. '_id' and 'name' are required.",
        });
    }

    try {
        const updatedWorkspace = await Workspace.findByIdAndUpdate(
            _id,
            { name },
            { new: true } // Return the updated document
        );

        if (!updatedWorkspace) {
            return res.status(404).json({
                message: "Workspace not found.",
            });
        }

        res.status(200).json({
            message: "Workspace renamed successfully.",
            workspace: updatedWorkspace,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Internal server error.",
        });
    }
};
