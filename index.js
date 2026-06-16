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
    const subscriptionsCollection = db.collection("subscriptions");
    const sessionCollection = authDb.collection("session");
    const savedJobsCollection = db.collection("savedJobs");

    // ── Middleware ──
    const verifyToken = async (req, res, next) => {
      const authHeader = req.headers?.authorization;
      if (!authHeader) return res.status(401).json({ message: "Unauthorized" });

      const token = authHeader.split(" ")[1];
      if (!token) return res.status(401).json({ message: "Unauthorized" });

      const session = await sessionCollection.findOne({ token });
      if (!session) return res.status(401).json({ message: "Unauthorized" });

      const user = await usersCollection.findOne({
        _id: new ObjectId(session.userId),
      });
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      req.user = user;
      next();
    };

    const verifySeeker = (req, res, next) => {
      if (req.user?.role !== "seeker")
        return res.status(403).json({ message: "Forbidden" });
      next();
    };
    const verifyRecruiter = (req, res, next) => {
      if (req.user?.role !== "recruiter")
        return res.status(403).json({ message: "Forbidden" });
      next();
    };
    const verifyAdmin = (req, res, next) => {
      if (req.user?.role !== "admin")
        return res.status(403).json({ message: "Forbidden" });
      next();
    };

    //user

    app.get("/users/:id/plan", verifyToken, async (req, res) => {
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

    // Jobs — recruiter only

    // POST /jobs
    app.post("/jobs", verifyToken, verifyRecruiter, async (req, res) => {
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

    // GET /jobs — supports optional server-side pagination
    app.get("/jobs", async (req, res) => {
      try {
        const {
          companyId,
          status,
          search,
          category,
          jobType,
          sort,
          page,
          limit = "9",
        } = req.query;

        // ── Build query ──
        const query = {};
        if (companyId) query.companyId = companyId;
        if (status) query.status = status;
        if (category) query.category = category;
        if (jobType) {
          if (jobType === "Remote") query.isRemote = true;
          else query.jobType = jobType;
        }
        if (search) {
          query.$or = [
            { title: { $regex: search, $options: "i" } },
            { category: { $regex: search, $options: "i" } },
            { city: { $regex: search, $options: "i" } },
          ];
        }

        const sortObj =
          sort === "salary" ? { salaryMax: -1 } : { createdAt: -1 };

        // ── Paginated ──
        if (page) {
          const pageNum = Math.max(1, parseInt(page));
          const limitNum = Math.max(1, parseInt(limit));
          const skip = (pageNum - 1) * limitNum;

          const [jobs, total] = await Promise.all([
            jobsCollection
              .find(query)
              .sort(sortObj)
              .skip(skip)
              .limit(limitNum)
              .toArray(),
            jobsCollection.countDocuments(query),
          ]);

          return res.json({
            jobs,
            total,
            totalPages: Math.ceil(total / limitNum),
            page: pageNum,
          });
        }

        // ── All jobs (backward compat) ──
        const result = await jobsCollection.find(query).sort(sortObj).toArray();
        res.json(result);
      } catch (err) {
        console.error(err);
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
    app.patch("/jobs/:id", verifyToken, verifyRecruiter, async (req, res) => {
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
    app.delete("/jobs/:id", verifyToken, verifyRecruiter, async (req, res) => {
      try {
        const result = await jobsCollection.deleteOne({
          _id: new ObjectId(req.params.id),
        });
        res.json(result);
      } catch {
        res.status(500).json({ message: "Server error" });
      }
    });

    // Companies — recruiter only

    // POST /api/companies
    app.post(
      "/api/companies",
      verifyToken,
      verifyRecruiter,
      async (req, res) => {
        try {
          const result = await companiesCollection.insertOne({
            ...req.body,
            createdAt: new Date(),
          });
          res.send(result);
        } catch {
          res.status(500).json({ message: "Server error" });
        }
      },
    );

    // GET /companies?recruiterId=xxx OR ?userId=xxx OR all
    app.get("/companies", async (req, res) => {
      try {
        const query = {};
        if (req.query.recruiterId) query.recruiterId = req.query.recruiterId;
        if (req.query.userId) query.recruiterId = req.query.userId;

        const companies = await companiesCollection.find(query).toArray();

        const enriched = await Promise.all(
          companies.map(async (company) => {
            try {
              const companyId = company._id?.$oid || company._id?.toString();

              // user email
              let user = null;
              try {
                user = await usersCollection.findOne({
                  _id: new ObjectId(company.recruiterId),
                });
              } catch {}

              // job count
              const jobCount = await jobsCollection.countDocuments({
                companyId: companyId,
              });

              return { ...company, email: user?.email || null, jobCount };
            } catch {
              return company;
            }
          }),
        );

        res.send(enriched);
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

    app.patch(
      "/api/companies/:id/status",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { status } = req.body;
          const result = await companiesCollection.findOneAndUpdate(
            { _id: new ObjectId(req.params.id) },
            { $set: { status, updatedAt: new Date() } },
            { returnDocument: "after" },
          );
          res.json(result);
        } catch {
          res.status(500).json({ message: "Server error" });
        }
      },
    );

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
          seeker_free: { id: "seeker_free", maxApplicationsPerMonth: 3 },
          seeker_pro: { id: "seeker_pro", maxApplicationsPerMonth: 30 },
          seeker_premium: {
            id: "seeker_premium",
            maxApplicationsPerMonth: 999,
          },
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
    //plan updated by user
    app.patch("/users/:id/plan", async (req, res) => {
      try {
        const { plan } = req.body;
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { plan, updatedAt: new Date() } },
        );
        res.json({ success: true, result });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
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
    // ─── SUBSCRIPTIONS

    // POST /subscriptions — payment success call
    app.post("/subscriptions", async (req, res) => {
      try {
        const {
          userId,
          planId,
          email,
          stripeCustomerId,
          stripeSubscriptionId,
          stripePriceId,
          status,
          currentPeriodEnd,
        } = req.body;

        // subscriptions collection
        await subscriptionsCollection.findOneAndUpdate(
          { userId },
          {
            $set: {
              userId,
              planId,
              email,
              stripeCustomerId,
              stripeSubscriptionId,
              stripePriceId,
              status,
              currentPeriodEnd: new Date(currentPeriodEnd),
              updatedAt: new Date(),
            },
            $setOnInsert: { createdAt: new Date() },
          },
          { upsert: true },
        );

        // users collection এ plan update
        await usersCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { plan: planId, planUpdatedAt: new Date() } },
        );

        res.json({ success: true });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // GET /subscriptions/:userId
    app.get("/subscriptions/:userId", async (req, res) => {
      try {
        const subscriptionsCollection = db.collection("subscriptions");
        const sub = await subscriptionsCollection.findOne({
          userId: req.params.userId,
        });
        res.json(sub || null);
      } catch (err) {
        res.status(500).json({ message: "Server error" });
      }
    });

    // ---Admin
    // GET /admin/users
    app.get("/admin/users", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const users = await usersCollection.find({}).toArray();
        res.json(users);
      } catch {
        res.status(500).json({ message: "Server error" });
      }
    });
    //admin saw all payment
    app.get(
      "/admin/subscriptions",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const subscriptionsCollection = db.collection("subscriptions");
          const result = await subscriptionsCollection.find({}).toArray();
          res.json(result);
        } catch {
          res.status(500).json({ message: "Server error" });
        }
      },
    );
    // PATCH /admin/users/:id/role
    app.patch(
      "/admin/users/:id/role",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { role } = req.body;
          await usersCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { role, updatedAt: new Date() } },
          );
          res.json({ success: true });
        } catch {
          res.status(500).json({ message: "Server error" });
        }
      },
    );

    // PATCH /admin/users/:id/status
    app.patch(
      "/admin/users/:id/status",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { status } = req.body; // "active" or "suspended"
          await usersCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status, updatedAt: new Date() } },
          );
          res.json({ success: true });
        } catch {
          res.status(500).json({ message: "Server error" });
        }
      },
    );

    // DELETE /admin/users/:id
    app.delete(
      "/admin/users/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          await usersCollection.deleteOne({ _id: new ObjectId(req.params.id) });
          res.json({ success: true });
        } catch {
          res.status(500).json({ message: "Server error" });
        }
      },
    );

    // Book mark
    // POST /saved-jobs — save a job
    app.post("/saved-jobs", verifyToken, async (req, res) => {
      try {
        const { jobId } = req.body;
        const userId = req.user._id.toString();

        const existing = await savedJobsCollection.findOne({ userId, jobId });
        if (existing) {
          return res.status(400).json({ message: "Already saved" });
        }

        const result = await savedJobsCollection.insertOne({
          userId,
          jobId,
          createdAt: new Date(),
        });

        res.status(201).json({ success: true, insertedId: result.insertedId });
      } catch {
        res.status(500).json({ message: "Server error" });
      }
    });

    // DELETE /saved-jobs?jobId=xxx — unsave a job
    app.delete("/saved-jobs", verifyToken, async (req, res) => {
      try {
        const { jobId } = req.query;
        const userId = req.user._id.toString();
        await savedJobsCollection.deleteOne({ userId, jobId });
        res.json({ success: true });
      } catch {
        res.status(500).json({ message: "Server error" });
      }
    });

    // GET /saved-jobs?userId=xxx — list saved jobs of a user
    app.get("/saved-jobs", async (req, res) => {
      try {
        const { userId } = req.query;
        if (!userId) return res.json([]);
        const result = await savedJobsCollection.find({ userId }).toArray();
        res.json(result);
      } catch {
        res.status(500).json({ message: "Server error" });
      }
    });

    // await client.db("admin").command({ ping: 1 });
    console.log("Connected to MongoDB!");
  } finally {
    // await client.close();
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
