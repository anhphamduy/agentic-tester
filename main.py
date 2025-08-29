import uvicorn


if __name__ == "__main__":
    # Run FastAPI server
    uvicorn.run("app.api:app", host="0.0.0.0", port=7111, reload=False)
