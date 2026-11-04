import {
  Engine,
  Rectangle,
  Vector2,
  Text,
  Sprite,
  Scene,
  Circle,
  VisibilityComponent,
  PhysicsComponent,
  Input,
  GameObject,
  Loader as ResourceLoader
} from 'dino-ge';

class MenuScene extends Scene {
  constructor(game, onStart) {
    super();
    this.game = game;
    this.onStart = onStart;
  }

  onLoad() {
    this.game.cursor = 'pointer';

    this.title = new Text({
      tag: 'title',
      text: 'DINO SURVIVAL',
      fontSize: 64,
      colour: '#43aa8b',
      position: new Vector2(this.game.width / 2 - 250, 100),
      width: 500,
      zIndex: 10
    });

    this.startBtn = new Text({
      tag: 'start-btn',
      text: 'CLICK TO START',
      fontSize: 32,
      colour: 'white',
      position: new Vector2(this.game.width / 2 - 150, 300),
      width: 300,
      zIndex: 10,
      onClick: () => this.onStart()
    });

    this.controls = new Text({
      tag: 'controls',
      text: 'WASD to Move - SPACE to Shoot',
      fontSize: 20,
      colour: '#a0a0a0',
      position: new Vector2(this.game.width / 2 - 150, 410),
      width: 300,
      zIndex: 10
    });
  }

  onResize(width) {
    if (this.title && this.startBtn && this.controls) {
      this.title.transform.position.x = width / 2 - 250;
      this.startBtn.transform.position.x = width / 2 - 150;
      this.controls.transform.position.x = width / 2 - 150;
    }
  }
}

class PlayScene extends Scene {
  static WORLD_WIDTH = 2000;
  static WORLD_HEIGHT = 2000;

  constructor(game, onGameOver) {
    super();
    this.game = game;
    this.onGameOver = onGameOver;
    this.score = 0;
    this.lives = 3;
    this.lastShotTime = 0;
    this.shotCooldown = 250;
    this.lastMeteorSpawn = 0;
    this.isInvulnerable = false;
    this.invulnerabilityDuration = 2000;
    this.lastHitTime = 0;
    this.highScore = parseInt(localStorage.getItem('dinoHighScore') || '0', 10);
    this.startTime = Date.now();

    this.fireballs = [];
    this.meteors = [];
    this.particles = [];
    this.starsMid = [];
    this.starsNear = [];

    this.shakeIntensity = 0;
    this.shakeDecay = 0.9;
  }

  onLoad() {
    this.game.cursor = 'none';
    this.startTime = Date.now();

    // Background Layers (Hierarchical)
    const background = new GameObject('background', -10);
    this.add(background);

    const midStarsLayer = new GameObject('stars-mid', -5);
    background.transform.addChild(midStarsLayer.transform);

    const nearStarsLayer = new GameObject('stars-near', -2);
    background.transform.addChild(nearStarsLayer.transform);

    // Mid Stars (Slow, small)
    for (let i = 0; i < 100; i++) {
      const star = new Rectangle({
        position: new Vector2(
          Math.random() * PlayScene.WORLD_WIDTH,
          Math.random() * PlayScene.WORLD_HEIGHT
        ),
        width: 2,
        height: 2,
        colour: 'rgba(255, 255, 255, 0.5)',
        zIndex: 1
      });
      star.speed = 1 + Math.random() * 2;
      midStarsLayer.transform.addChild(star.transform);
      this.starsMid.push(star);
    }

    // Near Stars (Very fast, large, bright)
    for (let i = 0; i < 40; i++) {
      const star = new Rectangle({
        position: new Vector2(
          Math.random() * PlayScene.WORLD_WIDTH,
          Math.random() * PlayScene.WORLD_HEIGHT
        ),
        width: 3,
        height: 3,
        colour: 'rgba(255, 255, 255, 0.9)',
        zIndex: 2
      });
      star.speed = 3 + Math.random() * 4;
      nearStarsLayer.transform.addChild(star.transform);
      this.starsNear.push(star);
    }

    this.player = new Sprite({
      img: 'dino',
      rows: 1,
      cols: 24,
      position: new Vector2(
        PlayScene.WORLD_WIDTH / 2,
        PlayScene.WORLD_HEIGHT / 2
      ),
      startCol: 4,
      endCol: 10,
      tag: 'player',
      zIndex: 5,
      scale: 3
    });
    this.player.addComponent(new VisibilityComponent());
    this.player.addComponent(new PhysicsComponent());
    this.player.play();

    // Auto-collision handling for player
    this.player.on('collision', (e) => {
      const { other } = e.detail;
      if (other.metadata.tag === 'meteor' && !this.isInvulnerable) {
        this.lives -= 1;
        console.log(`Player hit! Lives remaining: ${this.lives}`);
        this.livesText.text = `Lives: ${this.lives}`;
        this.shakeIntensity = 20;

        if (this.lives <= 0) {
          const finalScore =
            this.score + Math.floor((Date.now() - this.startTime) / 1000);
          this.onGameOver(finalScore);
        } else {
          this.isInvulnerable = true;
          this.player.getComponent(PhysicsComponent).isSensor = true;
          this.lastHitTime = Date.now();
          this.spawnExplosion(this.player.transform.position, 20, '#F94144');
          other.destroySelf();
          this.meteors = this.meteors.filter((m) => m !== other);
        }
      }
    });

    // Scene Graph Parenting
    // Create a name tag for the dino
    this.nameTag = new Text({
      tag: 'name-tag',
      text: 'Dino',
      fontSize: '12',
      colour: 'white',
      position: new Vector2(-5, 20), // Compensated for parent scale: 3
      width: 100,
      zIndex: 6
    });
    this.nameTag.transform.scale = new Vector2(0.333, 0.333); // Keep size absolute
    this.player.transform.addChild(this.nameTag.transform);

    // Group UI elements under a container
    this.uiContainer = new GameObject('ui-root', 10);
    this.add(this.uiContainer);

    this.scoreText = new Text({
      tag: 'score',
      text: 'Score: 0',
      fontSize: '24',
      colour: 'white',
      position: new Vector2(this.game.width / 2 - 75, 20),
      width: 150,
      zIndex: 11
    });
    this.uiContainer.transform.addChild(this.scoreText.transform);

    this.livesText = new Text({
      tag: 'lives',
      text: `Lives: ${this.lives}`,
      fontSize: '24',
      colour: '#F94144',
      position: new Vector2(20, 20),
      width: 150,
      zIndex: 11,
      horizontalAlign: 'left'
    });
    this.uiContainer.transform.addChild(this.livesText.transform);
  }

  update() {
    const playerTransform = this.player.transform;
    const now = Date.now();

    // Movement Logic
    const moveSpeed = 400;
    let targetVX = 0;
    let targetVY = 0;

    if (Input.isKeyDown('w') || Input.isKeyDown('arrowup'))
      targetVY = -moveSpeed;
    else if (Input.isKeyDown('s') || Input.isKeyDown('arrowdown'))
      targetVY = moveSpeed;

    if (Input.isKeyDown('a') || Input.isKeyDown('arrowleft'))
      targetVX = -moveSpeed;
    else if (Input.isKeyDown('d') || Input.isKeyDown('arrowright'))
      targetVX = moveSpeed;

    if (targetVX !== 0 && targetVY !== 0) {
      targetVX *= 0.707;
      targetVY *= 0.707;
    }

    const playerPhysics = this.player.getComponent(PhysicsComponent);
    playerPhysics.velocity.x = targetVX;
    playerPhysics.velocity.y = targetVY;

    // Bounds Checking
    const pw = this.player.bounds ? this.player.bounds.width : 0;
    const ph = this.player.bounds ? this.player.bounds.height : 0;

    if (playerTransform.position.x < 0) playerTransform.position.x = 0;
    if (playerTransform.position.x > PlayScene.WORLD_WIDTH - pw)
      playerTransform.position.x = PlayScene.WORLD_WIDTH - pw;
    if (playerTransform.position.y < 0) playerTransform.position.y = 0;
    if (playerTransform.position.y > PlayScene.WORLD_HEIGHT - ph)
      playerTransform.position.y = PlayScene.WORLD_HEIGHT - ph;

    if (targetVX < 0) this.player.flip = true;
    else if (targetVX > 0) this.player.flip = false;

    // Shooting System
    const isShooting = Input.isKeyDown(' ') || Input.isKeyDown('mouse0');
    if (now - this.lastShotTime > this.shotCooldown && isShooting) {
      const fireball = new Circle({
        position: new Vector2(
          playerTransform.position.x + pw / 2 - 5,
          playerTransform.position.y
        ),
        radius: 5,
        colour: '#FFB703',
        zIndex: 6,
        tag: 'fireball'
      });
      fireball.addComponent(new PhysicsComponent());
      fireball.getComponent(PhysicsComponent).velocity.y = -600;

      fireball.on('collision', (e) => {
        const { other } = e.detail;
        if (other.metadata.tag === 'meteor') {
          this.spawnExplosion(
            other.transform.position,
            other.radius,
            other.colour
          );
          other.destroySelf();
          fireball.destroySelf();
          this.score += 10;
          this.shakeIntensity = Math.max(this.shakeIntensity, 5);
          this.meteors = this.meteors.filter((m) => m !== other);
          this.fireballs = this.fireballs.filter((fb) => fb !== fireball);
        }
      });

      this.fireballs.push(fireball);
      this.lastShotTime = now;
    }

    // Cleanup off-screen fireballs
    this.fireballs = this.fireballs.filter((fb) => {
      if (fb.transform.position.y < Engine.camera.position.y - 50) {
        fb.destroySelf();
        return false;
      }
      return true;
    });

    // Update and Cleanup Particles
    this.particles = this.particles.filter((p) => {
      p.life -= 0.02;
      if (p.life <= 0) {
        p.destroySelf();
        return false;
      }
      return true;
    });

    // Camera follows player
    Engine.camera.follow(this.player, this.game.width, this.game.height);

    // Apply Screen Shake
    if (this.shakeIntensity > 0.1) {
      Engine.camera.position.x += (Math.random() - 0.5) * this.shakeIntensity;
      Engine.camera.position.y += (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeIntensity *= this.shakeDecay;
    } else {
      this.shakeIntensity = 0;
    }

    // Update Invulnerability
    if (this.isInvulnerable) {
      const visibility = this.player.getComponent(VisibilityComponent);
      if (visibility) {
        visibility.visible = Math.floor(now / 100) % 2 === 0;
      }
      if (now - this.lastHitTime > this.invulnerabilityDuration) {
        this.isInvulnerable = false;
        this.player.getComponent(PhysicsComponent).isSensor = false;
        if (visibility) visibility.visible = true;
      }
    }

    // Fixed UI container
    this.uiContainer.transform.position.x = Engine.camera.position.x;
    this.uiContainer.transform.position.y = Engine.camera.position.y;

    // Parallax
    this.starsMid.forEach((s) => {
      s.transform.position.y += s.speed;
      if (s.transform.position.y > PlayScene.WORLD_HEIGHT)
        s.transform.position.y = 0;
    });
    this.starsNear.forEach((s) => {
      s.transform.position.y += s.speed;
      if (s.transform.position.y > PlayScene.WORLD_HEIGHT)
        s.transform.position.y = 0;
    });

    // Spawn Meteors
    if (Math.random() < 0.05) {
      const radius = 15 + Math.random() * 20;
      const spawnX = Engine.camera.position.x + Math.random() * this.game.width;
      const meteor = new Circle({
        position: new Vector2(spawnX, Engine.camera.position.y - 100),
        radius: radius,
        colour: '#F94144',
        zIndex: 4,
        tag: 'meteor'
      });
      meteor.addComponent(new PhysicsComponent());
      const meteorPhys = meteor.getComponent(PhysicsComponent);
      meteorPhys.velocity.y = 100 + Math.random() * 200;
      meteorPhys.acceleration.y = 50;
      this.meteors.push(meteor);
    }

    this.meteors = this.meteors.filter((m) => {
      if (
        m.transform.position.y >
        Engine.camera.position.y + this.game.height + 100
      ) {
        m.destroySelf();
        return false;
      }
      return true;
    });

    const timeScore = Math.floor((now - this.startTime) / 1000);
    this.scoreText.text = `Score: ${this.score + timeScore}`;
  }

  spawnExplosion(pos, radius, colour) {
    for (let i = 0; i < 8; i++) {
      const p = new Circle({
        position: new Vector2(pos.x + radius, pos.y + radius),
        radius: 2 + Math.random() * 3,
        colour: colour,
        zIndex: 3,
        tag: 'particle'
      });
      p.addComponent(new PhysicsComponent());
      const pPhys = p.getComponent(PhysicsComponent);
      pPhys.velocity.x = (Math.random() - 0.5) * 400;
      pPhys.velocity.y = (Math.random() - 0.5) * 400;
      p.life = 1.0;
      this.particles.push(p);
    }
  }
}

class GameOverScene extends Scene {
  constructor(game, score, onRestart) {
    super();
    this.game = game;
    this.score = score;
    this.onRestart = onRestart;
    this.highScore = parseInt(localStorage.getItem('dinoHighScore') || '0', 10);
  }

  onLoad() {
    this.game.cursor = 'pointer';

    this.gameOverText = new Text({
      tag: 'gameOver',
      text: 'GAME OVER',
      fontSize: '60',
      colour: '#F94144',
      position: new Vector2(this.game.width / 2 - 200, 150),
      width: 400,
      zIndex: 10
    });

    this.finalScoreText = new Text({
      tag: 'finalScore',
      text: `Score: ${this.score}`,
      fontSize: '30',
      colour: 'white',
      position: new Vector2(this.game.width / 2 - 100, 250),
      width: 200,
      zIndex: 10
    });

    if (this.score > this.highScore) {
      localStorage.setItem('dinoHighScore', this.score.toString());
      this.highScoreText = new Text({
        tag: 'newHigh',
        text: 'NEW HIGH SCORE!',
        fontSize: '24',
        colour: '#FFB703',
        position: new Vector2(this.game.width / 2 - 100, 300),
        width: 200,
        zIndex: 10
      });
    } else {
      this.highScoreText = new Text({
        tag: 'highScore',
        text: `High Score: ${this.highScore}`,
        fontSize: '24',
        colour: '#a0a0a0',
        position: new Vector2(this.game.width / 2 - 100, 300),
        width: 200,
        zIndex: 10
      });
    }

    this.restartBtn = new Text({
      tag: 'restart-btn',
      text: 'PLAY AGAIN',
      fontSize: '32',
      colour: '#43aa8b',
      position: new Vector2(this.game.width / 2 - 100, 400),
      width: 200,
      zIndex: 10,
      onClick: () => this.onRestart()
    });
  }

  onResize(width) {
    if (
      this.gameOverText &&
      this.finalScoreText &&
      this.highScoreText &&
      this.restartBtn
    ) {
      this.gameOverText.transform.position.x = width / 2 - 200;
      this.finalScoreText.transform.position.x = width / 2 - 100;
      this.highScoreText.transform.position.x = width / 2 - 100;
      this.restartBtn.transform.position.x = width / 2 - 100;
    }
  }
}

class DinoSurvival {
  constructor() {
    let disposed = false;
    const onGameOver = event => this.showGameOver(event.detail);
    const onStart = () => this.startGame();
    const onMenu = () => this.showMenu();
    this.game = new Engine(
      {
        onLoad: async () => {
          ResourceLoader.queueImage('dino', new URL('./sprites/DinoSprites - doux.png', import.meta.url).href);
          await ResourceLoader.loadAll((percent) => {
            console.log(`Loading: ${Math.round(percent)}%`);
          });
          if (disposed) return;

          // Use Event Bus for Game State management
          Engine.on('GAME_OVER', onGameOver);
          Engine.on('START_GAME', onStart);
          Engine.on('SHOW_MENU', onMenu);

          this.showMenu();
        },
        onDispose: () => {
          disposed = true;
          Engine.off('GAME_OVER', onGameOver);
          Engine.off('START_GAME', onStart);
          Engine.off('SHOW_MENU', onMenu);
        },
        update: () => {}
      },
      {
        title: 'Dino Survival',
        backgroundColour: '#264653',
        containerId: 'playground-canvas-container'
      }
    );
  }

  showMenu() {
    Engine.currentScene = new MenuScene(this.game, () =>
      Engine.emit('START_GAME')
    );
  }

  startGame() {
    Engine.currentScene = new PlayScene(this.game, (score) =>
      Engine.emit('GAME_OVER', score)
    );
  }

  showGameOver(score) {
    Engine.currentScene = new GameOverScene(this.game, score, () =>
      Engine.emit('SHOW_MENU')
    );
  }
}

new DinoSurvival();
