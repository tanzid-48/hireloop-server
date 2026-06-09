require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("hire-loop-server is running");
});

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const authDb = client.db("hireloop_auth_db");

    const db = client.db("hire_loop_db");
    const jobsCollection = db.collection("jobs");
    const companiesCollection = db.collection("companies");
    const applicationsCollection = db.collection("applications");
    const usersCollection = authDb.collection("user");

    //user

    app.get("/users/:id/plan", async (req, res) => {
      try {
        const user = await usersCollection.findOne({
          _id: new ObjectId(req.params.id),
        });

        if (!user) return res.status(404).json({ message: "User not found" });

        const PLANS = {
          seeker_free: { name: "Free Tier", maxApplicationsPerMonth: 3 },
          seeker_pro: { name: "Pro", maxApplicationsPerMonth: 30 },
          seeker_premium: { name: "Premium", maxApplicationsPerMonth: 999 },
        };

        const planKey = user.plan || "seeker_free";
        const plan = PLANS[planKey] || PLANS.seeker_free;

        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const monthlyCount = await applicationsCollection.countDocuments({
          userId: req.params.id,
          createdAt: { $gte: startOfMonth },
        });

        res.json({
          ...plan,
          planKey,
          monthlyCount,
          remaining: Math.max(0, plan.maxApplicationsPerMonth - monthlyCount),
          hasReachedLimit: monthlyCount >= plan.maxApplicationsPerMonth,
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // ─── JOBS

    // POST /jobs
    app.post("/jobs", async (req, res) => {
      try {
        const result = await jobsCollection.insertOne({
          ...req.body,
          createdAt: new Date(),
        });
        res.send(result);
      } catch {
        res.status(500).json({ message: "Server error" });
      }
    });

    // GET /jobs?companyId=xxx&status=xxx
    app.get("/jobs", async (req, res) => {
      try {
        const query = {};
        if (req.query.companyId) query.companyId = req.query.companyId;
        if (req.query.status) query.status = req.query.status;
        const result = await jobsCollection.find(query).toArray();
        res.send(result);
      } catch {
        res.status(500).json({ message: "Server error" });
      }
    });

    // GET /jobs/:id
    app.get("/jobs/:id", async (req, res) => {
      try {
        const result = await jobsCollection.findOne({
          _id: new ObjectId(req.params.id),
        });
        if (!result) return res.status(404).json({ message: "Job not found" });
        res.json(result);
      } catch {
        res.status(500).json({ message: "Server error" });
      }
    });

    // PATCH /jobs/:id
    app.patch("/jobs/:id", async (req, res) => {
      try {
        const result = await jobsCollection.findOneAndUpdate(
          { _id: new ObjectId(req.params.id) },
          { $set: req.body },
          { returnDocument: "after" },
        );
        res.json(result);
      } catch {
        res.status(500).json({ message: "Server error" });
      }
    });

    // DELETE /jobs/:id
    app.delete("/jobs/:id", async (req, res) => {
      try {
        const result = await jobsCollection.deleteOne({
          _id: new ObjectId(req.params.id),
        });
        res.json(result);
      } catch {
        res.status(500).json({ message: "Server error" });
      }
    });

    // ─── COMPANIES

    // POST /api/companies
    app.post("/api/companies", async (req, res) => {
      try {
        const result = await companiesCollection.insertOne({
          ...req.body,
          createdAt: new Date(),
        });
        res.send(result);
      } catch {
        res.status(500).json({ message: "Server error" });
      }
    });

    // GET /companies?recruiterId=xxx OR ?userId=xxx OR all
    app.get("/companies", async (req, res) => {
      try {
        const query = {};
        if (req.query.recruiterId) query.recruiterId = req.query.recruiterId;
        if (req.query.userId) query.recruiterId = req.query.userId;
        const result = await companiesCollection.find(query).toArray();
        res.send(result);
      } catch {
        res.status(500).json({ message: "Server error" });
      }
    });

    // GET /api/company?recruiterId=xxx (single)
    app.get("/api/company", async (req, res) => {
      try {
        const { recruiterId } = req.query;
        if (!recruiterId)
          return res.status(400).json({ message: "recruiterId required" });
        const company = await companiesCollection.findOne({ recruiterId });
        res.json(company || null);
      } catch {
        res.status(500).json({ message: "Server error" });
      }
    });

    // GET /api/companies/:id
    app.get("/api/companies/:id", async (req, res) => {
      try {
        const company = await companiesCollection.findOne({
          _id: new ObjectId(req.params.id),
        });
        if (!company) return res.status(404).json({ message: "Not found" });
        res.json(company);
      } catch {
        res.status(500).json({ message: "Server error" });
      }
    });

    // PATCH /api/companies/:id
    app.patch("/api/companies/:id", async (req, res) => {
      try {
        const result = await companiesCollection.findOneAndUpdate(
          { _id: new ObjectId(req.params.id) },
          { $set: req.body },
          { returnDocument: "after" },
        );
        res.json(result);
      } catch {
        res.status(500).json({ message: "Server error" });
      }
    });

    // ─── APPLICATIONS
    // POST /applications
    app.post("/applications", async (req, res) => {
      try {
        const application = req.body;
        const { userId, jobId } = application;

        const existing = await applicationsCollection.findOne({
          userId,
          jobId,
        });
        if (existing) {
          return res
            .status(400)
            .json({ message: "Already applied for this job" });
        }

        // user authDb
        const user = await usersCollection.findOne({
          _id: new ObjectId(userId),
        });
        if (!user) return res.status(404).json({ message: "User not found" });

        const PLANS = {
          seeker_free: { name: "Free Tier", maxApplicationsPerMonth: 3 },
          seeker_pro: { name: "Pro", maxApplicationsPerMonth: 30 },
          seeker_premium: { name: "Premium", maxApplicationsPerMonth: 999 },
        };

        const planKey = user.plan || "seeker_free";
        const plan = PLANS[planKey] || PLANS.seeker_free;

        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const monthlyCount = await applicationsCollection.countDocuments({
          userId,
          createdAt: { $gte: startOfMonth },
        });

        if (monthlyCount >= plan.maxApplicationsPerMonth) {
          return res.status(403).json({
            message: `Monthly limit reached. Your ${plan.name} plan allows ${plan.maxApplicationsPerMonth} applications/month.`,
          });
        }

        const result = await applicationsCollection.insertOne({
          ...application,
          createdAt: new Date(),
        });

        return res.status(201).json({
          success: true,
          message: "Application submitted successfully",
          insertedId: result.insertedId,
        });
      } catch (err) {
        console.error(err);
        if (err.code === 11000) {
          return res
            .status(400)
            .json({ message: "Already applied for this job" });
        }
        return res.status(500).json({ message: "Internal Server Error" });
      }
    });
    // GET /applications
    app.get("/applications", async (req, res) => {
      try {
        const query = {};
        if (req.query.jobId) query.jobId = req.query.jobId;
        if (req.query.userId) query.userId = req.query.userId;
        const result = await applicationsCollection.find(query).toArray();
        res.json(result);
      } catch {
        res.status(500).json({ message: "Server error" });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log("Connected to MongoDB!");
  } finally {
    // await client.close();
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
