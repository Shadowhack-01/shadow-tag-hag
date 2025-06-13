import { supabase } from './supabaseClient.js';

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    
    // Login Form Handler
    if (loginForm) {
        loginForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            event.stopPropagation();

            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;

            if (!email || !password) {
                alert('Please enter both email and password');
                return;
            }

            const submitButton = loginForm.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging in...';

            try {
                const { data, error } = await supabase.auth.signInWithPassword({
                    email,
                    password
                });

                if (error) throw error;

                if (data?.user) {
                    console.log('Login successful, redirecting...');
                    localStorage.setItem('user', JSON.stringify(data.user));
                    window.location.href = './post.html';
                }

            } catch (error) {
                console.error('Login error:', error);
                alert(error.message || 'Failed to login');
            } finally {
                submitButton.disabled = false;
                submitButton.innerHTML = 'Login';
            }
        });
    }

    // Signup Form Handler
    if (signupForm) {
        signupForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            event.stopPropagation();

            const nickname = document.getElementById('nickname').value.trim();
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;

            if (!email || !password || !nickname) {
                alert('Please fill in all fields');
                return;
            }

            // Validate password strength
            if (password.length < 6) {
                alert('Password must be at least 6 characters long');
                return;
            }

            const submitButton = signupForm.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating Account...';

            try {
                // First create the auth user with minimal data
                const { data, error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            nickname: nickname
                        }
                    }
                });

                if (error) {
                    console.error('Auth error details:', error);
                    throw error;
                }

                if (data?.user) {
                    console.log('Auth user created successfully:', data.user);
                    
                    try {
                        // Create the user profile in the public users table
                        const { error: profileError } = await supabase
                            .from('users')
                            .insert([
                                {
                                    id: data.user.id,
                                    nickname,
                                    email,
                                    avatar_url: null,
                                    created_at: new Date().toISOString(),
                                    updated_at: new Date().toISOString()
                                }
                            ]);

                        if (profileError) {
                            console.error('Profile creation error:', profileError);
                            throw new Error('Failed to create user profile: ' + profileError.message);
                        }

                        // Show success message
                        signupForm.innerHTML = `
                            <div style="text-align:center;padding:2em;">
                                <i class="fas fa-check-circle" style="font-size:3em;color:#6f2dbd;margin-bottom:0.5em;"></i>
                                <h3>Account Created Successfully!</h3>
                                <p>Welcome to PeerTalk, ${nickname}!</p>
                                <p style="color:#666;margin-top:1em;">
                                    You can now <a href="login.html" style="color:#6f2dbd;text-decoration:none;">login</a> 
                                    to your account.
                                </p>
                            </div>
                        `;
                    } catch (profileError) {
                        console.error('Profile creation failed:', profileError);
                        // If profile creation fails, we should probably clean up the auth user
                        // But for now, we'll just show an error
                        throw new Error('Account created but profile setup failed. Please contact support.');
                    }
                }

            } catch (error) {
                console.error('Signup error:', error);
                alert(error.message || 'Failed to create account. Please try again.');
            } finally {
                submitButton.disabled = false;
                submitButton.innerHTML = 'Sign Up';
            }
        });
    }

    // Check if user is already logged in
    const checkAuth = async () => {
        try {
            const { data: { user }, error } = await supabase.auth.getUser();
            
            if (error) {
                // Only log if you want to debug
                // console.error('Auth error:', error);
                return;
            }

            // If user is logged in and trying to access login/signup pages, redirect to post.html
            if (user && (window.location.pathname.includes('login.html') || 
                        window.location.pathname.includes('signup.html'))) {
                window.location.href = './post.html';
            }
            
            // If user is not logged in and trying to access protected pages, redirect to login
            if (!user && window.location.pathname.includes('post.html')) {
                window.location.href = './login.html';
            }
        } catch (error) {
            // Only log if you want to debug
            // console.warn('Auth check skipped:', error);
        }
    };

    // Run auth check when page loads
    checkAuth();
});