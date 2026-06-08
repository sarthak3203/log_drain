import { Router } from 'express';
import axios from 'axios';
import { apiKeyAuth } from '../middleware/apiKey';
import { query } from '../db';
const router = Router();
// Create an alert rule
router.post('/alert-rules', apiKeyAuth, async (req, res) => {
 const project_id = (req as any).project_id;
 const { name, condition, service, notify_url, notify_email } = req.body;
 if (!condition) {
 return res.status(400).json({ error: 'Condition is required' });
 }
 const [rule] = await query(
 `INSERT INTO alert_rules (project_id, name, condition, service, notify_url,
notify_email)
 VALUES ($1, $2, $3, $4, $5, $6)
 RETURNING *`,
 [project_id, name, JSON.stringify(condition), service, notify_url, notify_email]
 );
 res.status(201).json(rule);
});
// List alert rules
router.get('/alert-rules', apiKeyAuth, async (req, res) => {
 const project_id = (req as any).project_id;
 const rules = await query(
 `SELECT * FROM alert_rules WHERE project_id = $1 ORDER BY created_at DESC`,
 [project_id]
 );
 res.json(rules);
});
// List recent alert events
router.get('/alerts', apiKeyAuth, async (req, res) => {
 const project_id = (req as any).project_id;
 const events = await query(
 `SELECT ae.*, ar.name as rule_name
 FROM alert_events ae
 JOIN alert_rules ar ON ae.rule_id = ar.id
 WHERE ae.project_id = $1
 ORDER BY ae.fired_at DESC
 LIMIT 50`,
 [project_id]
 );
 res.json(events);
});
// Function to fire an alert (called by workers)
export async function fireAlert(
 ruleId: string,
 projectId: string,
 details: any
): Promise<void> {
 const [rule] = await query(
 `SELECT * FROM alert_rules WHERE id = $1`,
 [ruleId]
 );
 if (!rule || !rule.active) return;
 // Record the event
 await query(
 `INSERT INTO alert_events (rule_id, project_id, details) VALUES ($1, $2, $3)`,
 [ruleId, projectId, JSON.stringify(details)]
 );
 // Fire webhook
 if (rule.notify_url) {
 try {
 await axios.post(rule.notify_url, {
 rule_name: rule.name,
 project_id: projectId,
 fired_at: new Date().toISOString(),
 details,
 });
 } catch (err) {
 console.error('Webhook delivery failed:', err);
 }
 }
}
export default router;
