import { useRef, useEffect, useState, useCallback } from "react";

interface Pipe {
  x: number;
  topHeight: number;
  passed: boolean;
}

type GameState = "ready" | "playing" | "gameover";

export function FlappyBird() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [gameState, setGameState] = useState<GameState>("ready");
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    const saved = localStorage.getItem("flappybird_highscore");
    return saved ? parseInt(saved, 10) : 0;
  });

  // Game state refs (to avoid stale closures in game loop)
  const gameStateRef = useRef<GameState>("ready");
  const scoreRef = useRef(0);
  const birdRef = useRef({ y: 200, velocity: 0 });
  const pipesRef = useRef<Pipe[]>([]);
  const frameCountRef = useRef(0);
  const animationIdRef = useRef<number>(0);

  // Game constants (easy mode - casual gameplay)
  const GRAVITY = 0.28;
  const JUMP_VELOCITY = -5.5;
  const PIPE_GAP = 180;
  const PIPE_WIDTH = 45;
  const PIPE_SPEED = 1.5;
  const BIRD_SIZE = 22;
  const BIRD_X = 50;

  const resetGame = useCallback(() => {
    birdRef.current = { y: 200, velocity: 0 };
    pipesRef.current = [];
    frameCountRef.current = 0;
    scoreRef.current = 0;
    setScore(0);
  }, []);

  const jump = useCallback(() => {
    if (gameStateRef.current === "ready") {
      gameStateRef.current = "playing";
      setGameState("playing");
      resetGame();
    } else if (gameStateRef.current === "playing") {
      birdRef.current.velocity = JUMP_VELOCITY;
    } else if (gameStateRef.current === "gameover") {
      gameStateRef.current = "ready";
      setGameState("ready");
      resetGame();
    }
  }, [resetGame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };
    updateSize();
    window.addEventListener("resize", updateSize);

    const gameLoop = () => {
      if (!ctx || !canvas) return;

      const { width, height } = canvas;

      // Clear canvas
      ctx.fillStyle = "#1a1a2e";
      ctx.fillRect(0, 0, width, height);

      // Draw ground
      ctx.fillStyle = "#16213e";
      ctx.fillRect(0, height - 40, width, 40);
      ctx.fillStyle = "#4ade80";
      ctx.fillRect(0, height - 42, width, 4);

      if (gameStateRef.current === "playing") {
        // Update bird
        birdRef.current.velocity += GRAVITY;
        birdRef.current.y += birdRef.current.velocity;

        // Check ground/ceiling collision
        if (
          birdRef.current.y < 0 ||
          birdRef.current.y + BIRD_SIZE > height - 40
        ) {
          gameStateRef.current = "gameover";
          setGameState("gameover");
          // Update high score
          if (scoreRef.current > highScore) {
            setHighScore(scoreRef.current);
            localStorage.setItem(
              "flappybird_highscore",
              scoreRef.current.toString(),
            );
          }
        }

        // Spawn pipes (every 150 frames for casual gameplay)
        frameCountRef.current++;
        if (frameCountRef.current % 150 === 0) {
          const minHeight = 60;
          const maxHeight = height - PIPE_GAP - 60 - 40;
          const topHeight = Math.random() * (maxHeight - minHeight) + minHeight;
          pipesRef.current.push({ x: width, topHeight, passed: false });
        }

        // Update pipes
        pipesRef.current = pipesRef.current.filter((pipe) => {
          pipe.x -= PIPE_SPEED;

          // Check collision
          const birdRight = BIRD_X + BIRD_SIZE;
          const birdBottom = birdRef.current.y + BIRD_SIZE;
          const pipeRight = pipe.x + PIPE_WIDTH;
          const bottomPipeTop = pipe.topHeight + PIPE_GAP;

          if (birdRight > pipe.x && BIRD_X < pipeRight) {
            if (
              birdRef.current.y < pipe.topHeight ||
              birdBottom > bottomPipeTop
            ) {
              gameStateRef.current = "gameover";
              setGameState("gameover");
              if (scoreRef.current > highScore) {
                setHighScore(scoreRef.current);
                localStorage.setItem(
                  "flappybird_highscore",
                  scoreRef.current.toString(),
                );
              }
            }
          }

          // Update score
          if (!pipe.passed && pipe.x + PIPE_WIDTH < BIRD_X) {
            pipe.passed = true;
            scoreRef.current++;
            setScore(scoreRef.current);
          }

          return pipe.x > -PIPE_WIDTH;
        });
      }

      // Draw pipes
      ctx.fillStyle = "#4ade80";
      pipesRef.current.forEach((pipe) => {
        // Top pipe
        ctx.fillRect(pipe.x, 0, PIPE_WIDTH, pipe.topHeight);
        // Pipe cap (top)
        ctx.fillStyle = "#22c55e";
        ctx.fillRect(pipe.x - 3, pipe.topHeight - 20, PIPE_WIDTH + 6, 20);
        ctx.fillStyle = "#4ade80";

        // Bottom pipe
        const bottomY = pipe.topHeight + PIPE_GAP;
        ctx.fillRect(pipe.x, bottomY, PIPE_WIDTH, height - bottomY - 40);
        // Pipe cap (bottom)
        ctx.fillStyle = "#22c55e";
        ctx.fillRect(pipe.x - 3, bottomY, PIPE_WIDTH + 6, 20);
        ctx.fillStyle = "#4ade80";
      });

      // Draw bird
      const birdY = birdRef.current.y;
      // Bird body
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.ellipse(
        BIRD_X + BIRD_SIZE / 2,
        birdY + BIRD_SIZE / 2,
        BIRD_SIZE / 2,
        BIRD_SIZE / 2.5,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      // Wing
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.ellipse(
        BIRD_X + BIRD_SIZE / 3,
        birdY + BIRD_SIZE / 2 + 2,
        BIRD_SIZE / 4,
        BIRD_SIZE / 5,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      // Eye
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.arc(
        BIRD_X + BIRD_SIZE / 2 + 4,
        birdY + BIRD_SIZE / 3,
        5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.fillStyle = "black";
      ctx.beginPath();
      ctx.arc(
        BIRD_X + BIRD_SIZE / 2 + 5,
        birdY + BIRD_SIZE / 3,
        2.5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      // Beak
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.moveTo(BIRD_X + BIRD_SIZE - 2, birdY + BIRD_SIZE / 2 - 2);
      ctx.lineTo(BIRD_X + BIRD_SIZE + 8, birdY + BIRD_SIZE / 2 + 2);
      ctx.lineTo(BIRD_X + BIRD_SIZE - 2, birdY + BIRD_SIZE / 2 + 6);
      ctx.fill();

      // Draw score
      ctx.fillStyle = "white";
      ctx.font = "bold 32px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(scoreRef.current.toString(), width / 2, 50);

      // Draw overlays
      if (gameStateRef.current === "ready") {
        ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = "white";
        ctx.font = "bold 28px sans-serif";
        ctx.fillText("Flappy Bird", width / 2, height / 2 - 40);
        ctx.font = "18px sans-serif";
        ctx.fillText("Tap to Start", width / 2, height / 2 + 10);
        ctx.font = "14px sans-serif";
        ctx.fillStyle = "#94a3b8";
        ctx.fillText(`High Score: ${highScore}`, width / 2, height / 2 + 50);
      }

      if (gameStateRef.current === "gameover") {
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = "#ef4444";
        ctx.font = "bold 28px sans-serif";
        ctx.fillText("Game Over", width / 2, height / 2 - 50);
        ctx.fillStyle = "white";
        ctx.font = "22px sans-serif";
        ctx.fillText(`Score: ${scoreRef.current}`, width / 2, height / 2);
        ctx.font = "16px sans-serif";
        ctx.fillStyle = "#94a3b8";
        ctx.fillText(
          `High Score: ${Math.max(scoreRef.current, highScore)}`,
          width / 2,
          height / 2 + 35,
        );
        ctx.fillStyle = "white";
        ctx.font = "16px sans-serif";
        ctx.fillText("Tap to Restart", width / 2, height / 2 + 80);
      }

      animationIdRef.current = requestAnimationFrame(gameLoop);
    };

    gameLoop();

    return () => {
      window.removeEventListener("resize", updateSize);
      cancelAnimationFrame(animationIdRef.current);
    };
  }, [highScore]);

  // Handle click/touch
  const handleInteraction = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      jump();
    },
    [jump],
  );

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-[400px] relative select-none touch-none"
      onClick={handleInteraction}
      onTouchStart={handleInteraction}
    >
      <canvas ref={canvasRef} className="w-full h-full rounded-lg" />
    </div>
  );
}
