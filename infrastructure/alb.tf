# ============================================================================
# Application Load Balancer — HTTP-only, in public subnets
# CloudFront terminates TLS from the user; CloudFront → ALB is HTTP over the
# AWS backbone. This is the standard pattern for CloudFront + ALB samples.
# ============================================================================

# ============================================================================
# ALB Security Group — allow inbound HTTP from anywhere (CloudFront)
# ============================================================================

resource "aws_security_group" "alb" {
  name        = "${var.project_name}-alb-${var.environment}"
  description = "Allow inbound HTTP (port 80) from CloudFront"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP from CloudFront"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-alb-sg"
  }
}

# ============================================================================
# Application Load Balancer
# ============================================================================

# checkov:skip=CKV_AWS_91: ALB access logs not required for this sample; CloudFront logs cover request auditing.
# checkov:skip=CKV_AWS_150: Deletion protection disabled for easy teardown of sample infrastructure.
# checkov:skip=CKV2_AWS_28: WAF not attached to ALB; CloudFront WAF is the perimeter defense layer (see CKV2_AWS_47 in cloudfront.tf).
resource "aws_lb" "backend" {
  name               = "${var.project_name}-alb-${var.environment}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  # SSE streaming needs long idle timeout — 120s (default is 60)
  idle_timeout = 120

  # Drop invalid HTTP headers for security hardening
  drop_invalid_header_fields = true

  tags = {
    Name = "${var.project_name}-alb"
  }
}

# ============================================================================
# Target Group — port 3001, health check on /api/health
# ============================================================================

resource "aws_lb_target_group" "backend" {
  name        = "${var.project_name}-tg-${var.environment}"
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/api/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 10
    matcher             = "200"
  }

  # Shorter drain for faster rollouts. SSE clients reconnect automatically.
  deregistration_delay = 30

  tags = {
    Name = "${var.project_name}-tg"
  }
}

# ============================================================================
# HTTP Listener (port 80) — forward to target group
# CloudFront handles TLS termination; ALB receives HTTP from CloudFront.
# ============================================================================

# checkov:skip=CKV_AWS_2: HTTP listener is intentional — CloudFront terminates TLS, ALB is HTTP-only behind CloudFront.
# checkov:skip=CKV_AWS_103: HTTPS redirect not needed — CloudFront enforces HTTPS at the edge.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.backend.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }

  tags = {
    Name = "${var.project_name}-http-listener"
  }
}
