const request = require('supertest');
const app = require('../../modules/backend/index');

describe('POST /api/routes/calculate', () => {
    it('should return 400 if coordinates are missing', async () => {
        const response = await request(app)
            .post('/api/routes/calculate')
            .send({});
        expect(response.status).toBe(400);
        expect(response.body.error).toBe(true);
    });

    it('should return 400 if coordinates are invalid types', async () => {
        const response = await request(app)
            .post('/api/routes/calculate')
            .send({
                start: { lat: '40.7128', lng: -74.0060 },
                end: { lat: 40.7306, lng: -73.9866 }
            });
        expect(response.status).toBe(400);
        expect(response.body.error).toBe(true);
    });

    it('should return 200 and a dummy route on valid coordinates', async () => {
        const response = await request(app)
            .post('/api/routes/calculate')
            .send({
                start: { lat: 40.7128, lng: -74.0060 },
                end: { lat: 40.7306, lng: -73.9866 }
            });
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data.path).toHaveLength(3);
        
        // Ensure the dummy data logic works as expected
        const path = response.body.data.path;
        expect(path[0].lat).toBe(40.7128);
        expect(path[2].lat).toBe(40.7306);
    });
});
