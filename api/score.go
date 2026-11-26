package handler

import (
	"encoding/json"
	"net/http")

type scoreRequest struct {
	Score int `json:"score"`
	Deliveries int `json:"deliveries"`
}

func Handler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		_ = json.NewEncoder(w).Encode(map[string]string{"error":"POST a score"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1024)
	var input scoreRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}
	if input.Score < 0 || input.Score > 10000000 || input.Deliveries < 0 || input.Deliveries > 5 {
		http.Error(w, `{"error":"score out of range"}`, http.StatusBadRequest)
		return
	}
	// This endpoint validates and acknowledges a run. Persistent global
	// leaderboards require a database or KV store; Vercel functions are stateless.
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"accepted": true,
		"score": input.Score,
		"deliveries": input.Deliveries,
		"message": "Nice run, delivery legend!",
	})
}