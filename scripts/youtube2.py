from ffmpeg import FFmpeg
from pytubefix import YouTube
from pytubefix.cli import on_progress
import os
import time

# Change SAVE_PATH as require !!
SAVE_PATH = "youtube_downloads"
file_extension = ".mp4"
# change 'preferred_resolution' below to your preferred max resolution
preferred_resolution = "1080"
preferred_video_itag = ""
best_resolution_so_far = "0"
audio_only_itag = ""

temp_video_file = os.path.join(SAVE_PATH, "temp.mp4")
temp_audio_file = os.path.join(SAVE_PATH, "temp.m4a")

# ANSI color codes for print console
RED     =   "\033[1;31m"
YELLOW  =   "\033[1;33m"
GREEN   =   "\033[1;32m"
BLUE    =   "\033[1;34m"
CYAN    =   "\033[1;36m"
OFF     =   "\033[0;0m "

def find_best_resolution(yt):
    for stream in yt.fmt_streams:

        global preferred_video_itag
        global best_resolution_so_far
        if stream.resolution and int(stream.resolution[:-1]) > int(best_resolution_so_far):
            preferred_video_itag = stream.itag
            best_resolution_so_far = stream.resolution[:-1]

        if stream.resolution and stream.resolution[:-1] == preferred_resolution:
            preferred_video_itag = stream.itag
            print(f"{GREEN}Using preferred video itag = {preferred_video_itag}{OFF}")
            break

mylist = [
    ]




def read_urls_from_file(filename):
    """Read URLs from a text file"""
    urls = []
    try:
        with open(filename, 'r', encoding='utf-8') as file:
            for line in file:
                url = line.strip()
                if url and not url.startswith('#'):  # Skip empty lines and comments
                    urls.append(url)
                    mylist.append(url)
        return urls
    except FileNotFoundError:
        print(f"Error: File '{filename}' not found.")
        return []
    except Exception as e:
        print(f"Error reading file: {str(e)}")
        return []


def download_youtube_video(url, output_path='downloads',video_number=1,prefix='v'):
    """Download a YouTube video from the given URL"""
    try:
        # Create output directory if it doesn't exist
        if not os.path.exists(output_path):
            os.makedirs(output_path)
            print(f"Created directory: {output_path}")
        
        # Create YouTube object
        yt = YouTube(url)
       
        resolucoes = yt.streams.all()
        for i in resolucoes: # displays the available resolutions
            print(i)
 
        stream = yt.streams.filter(res="720p",video_codec='avc1.4d401f').first()
        
        print(f"Resolution : {stream.resolution}")
        # Get video title for filename (remove invalid characters)
        title = "".join(c for c in yt.title if c.isalnum() or c in (' ', '-', '_')).rstrip()
        filename = f"{prefix}{video_number}-{title}.mp4"
        
        print(f"Downloading: {yt.title}")
        print(f"Duration: {yt.length} seconds")
        print(f"Views: {yt.views}")
        
        # Download the video
        print("Download started...")
        stream.download(output_path=output_path, filename=filename)
        
        print(f"✓ Successfully downloaded: {filename}")
        return True
        
    except Exception as e:
        print(f"✗ Error downloading {url}: {str(e)}")
        return False
    
    
def download_youtube_video1(url, output_path='downloads',video_number=1,prefix='v'):
    print(url)
    # preferred_video_itag = ""
    # best_resolution_so_far = "0"
    # audio_only_itag = ""

    try:
        yt = YouTube(url, on_progress_callback = on_progress)
        print(YELLOW + yt.title + OFF)
        # removing unwanted characters in the 'save as' filename (i.e. mainly the forward slash /)
        original_title = "".join(filter(lambda x: x not in "?.!/;:", yt.title))
        yt.title = "temp"


        # Use 'yt.fmt_streams' to find appropriate 'itag' and file_extension
        # VIDEO example: itag='313' ---> res='2160p'  itag='137' ---> res='1080p'
        # Find 'itag' for best resolution in yt.fmt_streams up to 'preferred_video_resolution'
        find_best_resolution(yt)
        video = yt.streams.get_by_itag(preferred_video_itag)
        video.download(output_path=SAVE_PATH)


        audio_only_itag = yt.streams.get_audio_only().itag
        audio = yt.streams.get_by_itag(audio_only_itag)
        print(f"{CYAN}Using preferred audio itag = {audio_only_itag}{OFF}")

        audio.download(output_path=SAVE_PATH)
        chacacter_count = min(len(original_title),45)
        video_path = prefix+ str(video_number)+original_title[:chacacter_count] + file_extension
        print("Saving at -- ",video_path)
        output_file = os.path.join(SAVE_PATH, video_path)
        print(output_file)
        ffmpeg = (
            FFmpeg()
            .option("y")
            .input(temp_video_file)
            .input(temp_audio_file)
            .output(
                output_file,
                vcodec='copy',
                acodec='aac',
            )
        )
        
        print("Merging video and audio with ffmpeg...")
        ffmpeg.execute()

        # delete temp files after you finish merging video and audio
        os.remove(temp_video_file)
        os.remove(temp_audio_file)

    except FileNotFoundError:
        print(RED + "FileNotFoundError" + OFF)
        os.remove(temp_video_file)
        os.remove(temp_audio_file)
    except Exception as e:
        if preferred_video_itag == "":
            print(RED + "preferred video itag not found" + OFF)
        elif audio_only_itag == "":
            print(RED + "preferred audio itag not found" + OFF)
        else:
            print(RED + "Some other error" + OFF)
            print(RED + str(e) + OFF)
            os.remove(temp_video_file)
            os.remove(temp_audio_file)



def main(input_file,start=0):
    output_directory = 'youtube_downloads'
    
    print("YouTube Video Downloader")
    print("=" * 50)
    
    # Read URLs from file
    urls = read_urls_from_file(input_file)
    
    if not urls:
        print("No URLs found in the file.")
        return
    
    print(f"Found {len(urls)} URLs in '{input_file}'")
    print("-" * 50)
    
    
    successful_downloads = 0
    failed_downloads = 0
    for i, url in enumerate(urls, 1):
        print(f"\n[{i}/{len(urls)}] Processing: {url}")
        
        if download_youtube_video1(url, output_directory,start+i):
            successful_downloads += 1
        else:
            failed_downloads += 1
        
        time.sleep(2)
    
    # Summary
    print("\n" + "=" * 50)
    print("Download Summary:")
    print(f"Total URLs processed: {len(urls)}")
    print(f"Successful downloads: {successful_downloads}")
    print(f"Failed downloads: {failed_downloads}")
    print(f"Videos saved in: {os.path.abspath(output_directory)}")

if __name__ == "__main__":
    input_file = 'keshav/keshav-6.txt'  # Change this to your file name
    start = 50
    main(input_file,start)

