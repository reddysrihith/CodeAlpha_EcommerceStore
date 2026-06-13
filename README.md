# Task 1 — E-commerce Store

CodeAlpha Full Stack Internship · Task 1

A full-stack e-commerce store with product listings, shopping cart, order processing, and user authentication.

## Features
- User registration & login (session-based auth)
- Browse and search products
- Add to cart / remove from cart
- Place orders & view order history
- Add new products (authenticated users)

## Tech Stack
- **Backend:** Node.js, Express.js
- **Database:** PostgreSQL
- **Auth:** bcryptjs + express-session + connect-pg-simple
- **Frontend:** Vanilla HTML/CSS/JavaScript

## Setup

### 1. Prerequisites
- Node.js 18+
- PostgreSQL database

### 2. Clone & install
```bash
git clone <your-repo-url>
cd task1-ecommerce
npm install
```

### 3. Configure environment
```bash
cp .env.example .env
# Edit .env and set your DATABASE_URL and SESSION_SECRET
```

### 4. Set up database
```bash
psql $DATABASE_URL -f schema.sql
```

### 5. Run
```bash
npm start
# Server runs at http://localhost:3000
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/register | — | Register a new user |
| POST | /api/auth/login | — | Login |
| POST | /api/auth/logout | ✓ | Logout |
| GET | /api/auth/me | ✓ | Get current user |
| GET | /api/products | — | List all products |
| GET | /api/products/:id | — | Get product detail |
| POST | /api/products | ✓ | Add a product |
| GET | /api/cart | ✓ | View cart |
| POST | /api/cart | ✓ | Add item to cart |
| DELETE | /api/cart/:id | ✓ | Remove item from cart |
| POST | /api/orders | ✓ | Place order (checkout) |
| GET | /api/orders | ✓ | My orders |
| GET | /api/orders/:id | ✓ | Order detail |
